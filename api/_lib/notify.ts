// api/_lib/notify.ts
// Client email updates through Resend (https://resend.com). Transactional only: one message per upload batch,
// sent to clients who have created their page password and opened the page at least once.
//
// Environment variables: RESEND_API_KEY, NOTIFY_FROM_EMAIL (for example "cirfan <updates@cirfan.com>"),
// NEXT_PUBLIC_EMAIL (used as the reply-to address and in the footer).

export const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export const notifyConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL);

export const sendUploadEmail = async (opts: {
  to: string;
  clientName: string;
  link: string;
  count: number;
  folders: string[];
  site: string;
}) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  const replyTo = process.env.NEXT_PUBLIC_EMAIL;
  if (!apiKey || !from) throw new Error('email not configured');

  const files = opts.count === 1 ? '1 new file was' : `${opts.count} new files were`;
  const where = opts.folders.length === 1 ? ` in the folder “${opts.folders[0]}”` : opts.folders.length > 1 ? ` in ${opts.folders.length} folders` : '';
  const text = [
    `Hi ${opts.clientName},`,
    '',
    `${files} added to your cirfan delivery page${where}.`,
    '',
    `Open your page: ${opts.link}`,
    'You’ll need the password you created for it.',
    '',
    replyTo ? `Questions? Reply to this email or write to ${replyTo}.` : 'Questions? Reply to this email.',
    '',
    'cirfan',
    opts.site,
    '',
    'You receive this because cirfan is delivering work to you. It is not a marketing email.',
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [opts.to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: 'New files on your cirfan page',
      text,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`email provider responded ${res.status}`);
};
