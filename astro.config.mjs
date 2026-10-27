// astro.config.mjs
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Change this if the production domain ever changes. Used for canonical URLs, Open Graph and the sitemap.
  site: 'https://cirfan.com',
  trailingSlash: 'never',
  build: {
    // /work.html is served as /work by Vercel (cleanUrls in vercel.json).
    format: 'file',
    // Keep every stylesheet as a file so the Content-Security-Policy can stay strict (no inline styles).
    inlineStylesheets: 'never',
  },
  integrations: [
    sitemap({
            filter: (page) => !/\/(404|thanks|not-a-fit|not-sent)$/.test(page),
    }),
  ],
  vite: {
    build: {
      // Never inline scripts or assets as data URIs: keeps CSP strict.
      assetsInlineLimit: 0,
    },
  },
  devToolbar: { enabled: false },
});
