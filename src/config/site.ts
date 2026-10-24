// src/config/site.ts
// Business details used across the whole site. Edit here, not in the pages.

export const site = {
  name: 'cirfan',
  pronunciation: 'sir-fan',
  url: 'https://cirfan.com',
  // Create this mailbox before launch (see README, "Before you launch").
  email: 'hello@cirfan.com',
  owner: 'Edward',
  ownerTitle: 'Founder and sole operator',
  tagline: 'AI image and video ad creatives, made to measure',
  description:
    'cirfan makes AI image and video ad creatives for brands, built from your best-performing ads and their metrics. No prompting, no tool learning curve.',
  // Date shown as "Last updated" on every policy page. Change it whenever a policy changes.
  policiesUpdated: '2026-10-23',
  // Optional public profiles. Leave empty to hide. Example: 'https://x.com/yourhandle'
  social: {
    x: '',
    instagram: '',
    linkedin: '',
  },
} as const;

export const nav = [
  { label: 'Work', href: '/work' },
  { label: 'Process', href: '/#process' },
  { label: 'About', href: '/about' },
] as const;

export const policies = [
  { label: 'AI disclosure', href: '/policies/ai-disclosure' },
  { label: 'IP ownership', href: '/policies/ip-ownership' },
  { label: 'Refunds', href: '/policies/refunds' },
  { label: 'Watermarks', href: '/policies/watermarks' },
  { label: 'No guarantees', href: '/policies/no-guarantees' },
  { label: 'Privacy', href: '/policies/privacy' },
] as const;

// Pre-filled email for the "Email your brief" button.
export const briefMailto = (() => {
  const subject = 'Project brief';
  const body = [
    'Brand and product:',
    '',
    'Best-performing creatives (links or attachments):',
    '',
    'Lifetime metrics for each (spend, hook rate, CTR, cost per result):',
    '',
    'Competitor references (optional):',
    '',
    'Where the ads will run:',
    '',
  ].join('\n');
  return `mailto:${site.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
})();

export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
