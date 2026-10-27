// src/data/questionnaire.js
// "See if we're a good fit" questionnaire.
// Shared by the page (src/pages/fit.astro) and the server function (api/fit.ts), so the
// answers the server accepts always match the choices people see.
//
// To change a question: edit its `legend` or `options` below. `value` is what gets sent and
// checked on the server, so keep values short, lowercase, and unique within a question.
// Amounts are in US dollars. Adjust the budget tiers to match your real pricing.
//
// Plain JavaScript on purpose: the server function imports it at runtime, and .js needs no compile step.

/**
 * @typedef {{ value: string, label: string }} Option
 * @typedef {{ id: string, legend: string, hint?: string, options: Option[] }} Question
 * @typedef {Record<string, string>} Answers
 */

/** @type {Question[]} */
export const questions = [
  {
    id: 'business',
    legend: 'What do you sell?',
    options: [
      { value: 'physical', label: 'Physical products online' },
      { value: 'digital', label: 'Digital products' },
      { value: 'services', label: 'Services' },
      { value: 'software', label: 'Apps or software' },
      { value: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'tests',
    legend: 'How many new ads do you test per month?',
    options: [
      { value: 'none', label: 'None yet' },
      { value: '1-4', label: '1 to 4' },
      { value: '5-10', label: '5 to 10' },
      { value: '11-20', label: '11 to 20' },
      { value: '20+', label: 'More than 20' },
    ],
  },
  {
    id: 'revenue',
    legend: 'What is your monthly revenue?',
    hint: 'In US dollars.',
    options: [
      { value: 'pre', label: 'Pre-revenue' },
      { value: 'under-10k', label: 'Under $10,000' },
      { value: '10k-50k', label: '$10,000 to $50,000' },
      { value: '50k-250k', label: '$50,000 to $250,000' },
      { value: '250k+', label: 'Over $250,000' },
    ],
  },
  {
    id: 'margin',
    legend: 'What is your profit margin after all expenses?',
    hint: 'After product cost, ad spend, fees, and everything else.',
    options: [
      { value: 'negative', label: 'Below 0%' },
      { value: '0-10', label: '0% to 10%' },
      { value: '11-20', label: '11% to 20%' },
      { value: '21-30', label: '21% to 30%' },
      { value: '30+', label: 'Over 30%' },
      { value: 'unsure', label: 'Not sure' },
    ],
  },
  {
    id: 'style',
    legend: 'Which ad style interests you most?',
    options: [
      { value: 'cinematic', label: 'Cinematic' },
      { value: 'ugc', label: 'UGC' },
      { value: 'mix', label: 'A mix of both' },
    ],
  },
  {
    id: 'platform',
    legend: 'Where will the ads mostly run?',
    options: [
      { value: 'meta', label: 'Facebook and Instagram' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'youtube', label: 'YouTube' },
      { value: 'several', label: 'Several platforms' },
    ],
  },
  {
    id: 'data',
    legend: 'Can you share results from past ads?',
    hint: 'Your best-performing creatives and their lifetime metrics are where every project starts.',
    options: [
      { value: 'full', label: 'Yes, with lifetime metrics' },
      { value: 'partial', label: 'Some, but incomplete' },
      { value: 'none', label: 'No, we haven’t run ads yet' },
    ],
  },
  {
    id: 'budget',
    legend: 'What is your monthly budget for new ad creatives?',
    hint: 'Creative production only, not ad spend.',
    options: [
      { value: '0', label: '$0' },
      { value: 'under-500', label: 'Under $500' },
      { value: '500-1500', label: '$500 to $1,500' },
      { value: '1500-5000', label: '$1,500 to $5,000' },
      { value: '5000+', label: 'Over $5,000' },
    ],
  },
  {
    id: 'timing',
    legend: 'When would you like to start?',
    options: [
      { value: 'now', label: 'Within 2 weeks' },
      { value: 'month', label: 'Within a month' },
      { value: 'exploring', label: 'Just exploring' },
    ],
  },
];

// Answers that end the questionnaire with a "not a fit right now" page. Nothing is sent or stored.
/** @type {Record<string, string[]>} */
export const disqualifiers = {
  budget: ['0'],
};

// Answers worth a closer look. They do not disqualify; they are listed at the top of the email you receive.
/** @type {Record<string, Record<string, string>>} */
export const flags = {
  margin: { negative: 'Negative margin', unsure: 'Does not know margin' },
  data: { none: 'No past ad data' },
  revenue: { pre: 'Pre-revenue' },
  budget: { 'under-500': 'Budget under $500' },
};

export const limits = {
  name: 80,
  email: 254,
  website: 200,
  notes: 1000,
};

/** @param {Answers} answers */
export const isDisqualified = (answers) =>
  Object.entries(disqualifiers).some(([id, values]) => values.includes(answers[id] ?? ''));

/** @param {Answers} answers @returns {string[]} */
export const flagsFor = (answers) =>
  Object.entries(flags).flatMap(([id, map]) => (map[answers[id] ?? ''] ? [map[answers[id]]] : []));

/** @param {string} questionId @param {string} value */
export const labelFor = (questionId, value) =>
  questions.find((q) => q.id === questionId)?.options.find((o) => o.value === value)?.label ?? value;
