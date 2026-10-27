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
    'cirfan makes short AI video ads and AI image ads for brands, built from your best-performing ads and their metrics. No prompting, no learning curve.',
  // Date shown as "Last updated" on every policy page. Change it whenever a policy changes.
  policiesUpdated: '2026-10-27',
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
  { label: 'Working together', href: '/working-together' },
  { label: 'About', href: '/about' },
] as const;

export const policies = [
  { label: 'AI disclosure', href: '/policies/ai-disclosure' },
  { label: 'IP ownership', href: '/policies/ip-ownership' },
  { label: 'Refunds', href: '/policies/refunds' },
  { label: 'Watermarks', href: '/policies/watermarks' },
  { label: 'No guarantees', href: '/policies/no-guarantees' },
  { label: 'AI accuracy', href: '/policies/ai-accuracy' },
  { label: 'Privacy', href: '/policies/privacy' },
] as const;

// Main call to action, used in the header, hero, page endings and footer.
export const fitCta = {
  label: 'See if we’re a good fit',
  note: 'Redirects to questionnaire',
  href: '/fit',
} as const;

export const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
