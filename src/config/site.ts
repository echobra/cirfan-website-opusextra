// src/config/site.ts
// Business details used across the whole site. Edit here, not in the pages.

// The contact email for the whole site, read at build time from the NEXT_PUBLIC_EMAIL environment variable
// (Vercel > Project > Settings > Environment Variables, or .env when building locally). Change it there and
// redeploy: every page, the footer, the structured data and the client pages pick it up.
// The build stops with a clear message if it is missing, so no page ships with a blank address.
const publicEmail: string = process.env.NEXT_PUBLIC_EMAIL || import.meta.env.NEXT_PUBLIC_EMAIL || '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail)) {
  throw new Error('NEXT_PUBLIC_EMAIL is missing or not an email address. Set it in Vercel (or .env locally), then rebuild.');
}

export const site = {
  name: 'cirfan',
  pronunciation: 'sir-fan',
  url: 'https://cirfan.com',
  // Every email address on the site comes from NEXT_PUBLIC_EMAIL (see `publicEmail` below).
  email: publicEmail,
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
