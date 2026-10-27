// api/fit.ts
// Vercel Function that receives the "See if we're a good fit" questionnaire (POST /api/fit).
// Every real submission is posted to Slack, labeled GOOD FIT or NOT A FIT. Nothing is emailed or stored here.
// The form is a plain HTML form, so it works without JavaScript. Every answer is checked against
// src/data/questionnaire.js; anything unexpected is rejected.
//
// Required environment variable (Vercel > Project > Settings > Environment Variables):
//   SLACK_FORM_WEBHOOK   Incoming Webhook URL for the Slack channel that receives submissions
// Optional:
//   SITE_ORIGIN          Defaults to https://cirfan.com

import { questions, limits, disqualifiers, isDisqualified, flagsFor, labelFor } from '../src/data/questionnaire.js';
import { go, isSameSiteRequest } from './_lib/http.js';
import { escapeSlack, postToSlack } from './_lib/slack.js';

type Answers = Record<string, string>;

const MAX_BODY_BYTES = 16_000;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

// Removes control characters and trims. Returns null when the value is too long.
const text = (value: FormDataEntryValue | null, max: number, multiline = false): string | null => {
  if (value === null) return '';
  if (typeof value !== 'string') return null;
  const cleaned = value
    .normalize('NFC')
    .replace(multiline ? /[\u0000-\u0008\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ')
    .trim();
  return cleaned.length > max ? null : cleaned;
};

const normalizeWebsite = (raw: string): string | null => {
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return null;
    return url.href;
  } catch {
    return null;
  }
};

const slackMessage = (
  answers: Answers,
  contact: { name: string; email: string; website: string; notes: string },
  disqualified: boolean,
) => {
  const verdict = disqualified ? 'NOT A FIT' : 'GOOD FIT';
  const flagged = flagsFor(answers);
  const reasons = Object.entries(disqualifiers)
    .filter(([id, values]) => values.includes(answers[id]))
    .map(([id]) => `${questions.find((q) => q.id === id)?.legend ?? id} ${labelFor(id, answers[id])}`);

  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: { type: 'plain_text', text: `${disqualified ? '🔴' : '🟢'} ${verdict}`, emoji: true } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          `*${escapeSlack(contact.name)}*`,
          escapeSlack(contact.email),
          contact.website ? escapeSlack(contact.website) : '_No website given_',
        ].join('\n'),
      },
    },
    {
      type: 'section',
      fields: questions.map((q) => ({
        type: 'mrkdwn',
        text: `*${escapeSlack(q.legend)}*\n${escapeSlack(labelFor(q.id, answers[q.id]))}`,
      })),
    },
  ];
  if (disqualified) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*Disqualified by:* ${escapeSlack(reasons.join('; '))}` }] });
  }
  if (flagged.length) {
    blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `*Flags:* ${escapeSlack(flagged.join(', '))}` }] });
  }
  if (contact.notes) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Notes*\n${escapeSlack(contact.notes).slice(0, 2900)}` } });
  }
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `Received ${new Date().toISOString()}` }] });

  return { text: `${verdict}: ${escapeSlack(contact.name)}`, blocks };
};

export function GET() {
  return go('/fit');
}

export async function POST(request: Request) {
  // 1. Only accept same-site form posts.
  if (!isSameSiteRequest(request)) return go('/not-sent');

  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('application/x-www-form-urlencoded')) return new Response('Unsupported Media Type', { status: 415 });

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return new Response('Payload Too Large', { status: 413 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return go('/not-sent');
  }

  // 2. Honeypot: real people never see or fill this field. Bots get a normal-looking page and Slack stays clean.
  if ((form.get('company_site') ?? '') !== '') return go('/thanks');

  // 3. Every question must have one of its listed answers.
  const answers: Answers = {};
  for (const q of questions) {
    const value = form.get(q.id);
    if (typeof value !== 'string' || !q.options.some((o) => o.value === value)) return go('/not-sent');
    answers[q.id] = value;
  }

  // 4. Contact details.
  const name = text(form.get('name'), limits.name);
  const email = text(form.get('email'), limits.email);
  const websiteRaw = text(form.get('website'), limits.website);
  const notes = text(form.get('notes'), limits.notes, true);
  const website = websiteRaw === null ? null : normalizeWebsite(websiteRaw);
  if (!name || !email || !EMAIL_PATTERN.test(email) || website === null || notes === null) return go('/not-sent');

  // 5. Log every real attempt to Slack, labeled.
  const disqualified = isDisqualified(answers);
  const sent = await postToSlack(
    process.env.SLACK_FORM_WEBHOOK,
    slackMessage(answers, { name, email, website, notes }, disqualified),
  );

  if (disqualified) return go('/not-a-fit');
  return go(sent ? '/thanks' : '/not-sent');
}
