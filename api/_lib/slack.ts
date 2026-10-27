// api/_lib/slack.ts
// Posts to a Slack Incoming Webhook. Everything people type is escaped so it can't ping @channel,
// hide links or break formatting.

export const escapeSlack = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const postToSlack = async (webhook: string | undefined, payload: Record<string, unknown>) => {
  if (!webhook || !webhook.startsWith('https://hooks.slack.com/')) {
    console.error('slack: webhook missing or not a hooks.slack.com URL');
    return false;
  }
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unfurl_links: false, unfurl_media: false, ...payload }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) console.error(`slack: responded ${res.status}`);
    return res.ok;
  } catch {
    console.error('slack: unreachable');
    return false;
  }
};
