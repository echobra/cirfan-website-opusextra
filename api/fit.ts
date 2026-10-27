// api/fit.ts
// Vercel Function that receives the "See if we're a good fit" questionnaire (POST /api/fit).
// The form is a plain HTML form, so it works without JavaScript. Every answer is checked
// against src/data/questionnaire.ts; anything unexpected is rejected.
//
// Required environment variables (Vercel > Project > Settings > Environment Variables):
//   RESEND_API_KEY   API key from resend.com (Sending access only)
//   FIT_TO_EMAIL     Inbox that receives submissions, for example you@yourmail.com
//   FIT_FROM_EMAIL   Verified sender, for example "cirfan <forms@cirfan.com>"
// Optional:
//   SITE_ORIGIN      Defaults to https://cirfan.com

import { questions, limits, isDisqualified, flagsFor, labelFor } from '../src/data/questionnaire.js';

type Answers = Record<string, string>;

const MAX_BODY_BYTES = 16_000;
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const go = (path: string) =>
  new Response(null, { status: 303, headers: { Location: path, 'Cache-Control': 'no-store' } });

const allowedOrigins = () => {
  const origins = new Set<string>([process.env.SITE_ORIGIN ?? 'https://cirfan.com', 'https://www.cirfan.com']);
  for (const key of ['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = process.env[key];
    if (host) origins.add(`https://${host}`);
  }
  // `vercel dev` runs on localhost:3000.
  if (!process.env.VERCEL || process.env.VERCEL_ENV === 'development') origins.add('http://localhost:3000');
  return origins;
};

// Removes control characters (which also blocks email header injection) and trims.
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

export function GET() {
  return go('/fit');
}

export async function POST(request: Request) {
  // 1. Only accept same-site form posts.
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins().has(origin)) return go('/not-sent');

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

  // 2. Honeypot: real people never see or fill this field. Bots get a normal-looking success page.
  if ((form.get('company_site') ?? '') !== '') return go('/thanks');

  // 3. Every question must have one of its listed answers.
  const answers: Answers = {};
  for (const q of questions) {
    const value = form.get(q.id);
    if (typeof value !== 'string' || !q.options.some((o) => o.value === value)) return go('/not-sent');
    answers[q.id] = value;
  }

  // 4. Disqualified: show the "not a fit" page and keep nothing.
  if (isDisqualified(answers)) return go('/not-a-fit');

  // 5. Contact details.
  const name = text(form.get('name'), limits.name);
  const email = text(form.get('email'), limits.email);
  const websiteRaw = text(form.get('website'), limits.website);
  const notes = text(form.get('notes'), limits.notes, true);
  const website = websiteRaw === null ? null : normalizeWebsite(websiteRaw);
  if (!name || !email || !EMAIL_PATTERN.test(email) || website === null || notes === null) return go('/not-sent');

  // 6. Email the submission.
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.FIT_TO_EMAIL;
  const from = process.env.FIT_FROM_EMAIL;
  if (!apiKey || !to || !from) {
    console.error('fit: missing RESEND_API_KEY, FIT_TO_EMAIL or FIT_FROM_EMAIL');
    return go('/not-sent');
  }

  const flagged = flagsFor(answers);
  const body = [
    'New "good fit" questionnaire',
    '',
    `Flags: ${flagged.length ? flagged.join(', ') : 'none'}`,
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Website: ${website || 'not given'}`,
    '',
    ...questions.map((q) => `${q.legend} ${labelFor(q.id, answers[q.id])}`),
    '',
    'Notes:',
    notes || 'none',
    '',
    `Received: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `Fit questionnaire: ${name}`,
        text: body,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error(`fit: email provider responded ${res.status}`);
      return go('/not-sent');
    }
  } catch {
    console.error('fit: email provider unreachable');
    return go('/not-sent');
  }

  return go('/thanks');
}
