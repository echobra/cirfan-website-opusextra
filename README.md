<!-- README.md -->
# cirfan.com

Marketing site and portfolio for cirfan, an AI image and video ad creative studio.
Built with [Astro](https://astro.build) as a fully static site. No server, no database, no third-party scripts.

## Run it locally

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # checks copy for em/en dashes, then builds to /dist
npm run preview    # serves the built site
```

## Where to edit things

| What | File |
| --- | --- |
| Business name, email, social links, policy date | `src/config/site.ts` |
| Portfolio pieces (home shows the first 2 with `featured: true`) | `src/data/portfolio.ts` |
| Home page copy (pain points, process, terms, FAQ, brief card) | `src/pages/index.astro` (arrays at the top) |
| About page | `src/pages/about.astro` |
| Policies (plain Markdown) | `src/pages/policies/*.md` |
| Colors, fonts, spacing | `src/styles/global.css` (tokens at the top) |
| Logo files | `public/logo.png`, `public/logo-on-dark.png`, `public/logo-mark*.png` |
| Editable logo sources (SVG) | `brand/` |
| Security headers, caching | `vercel.json` |

### Add a portfolio piece

1. Put `my-ad.mp4` (H.264, 9:16) and a poster `my-ad.webp` in `public/portfolio/`.
   Poster from any frame: `ffmpeg -ss 1 -i my-ad.mp4 -frames:v 1 -quality 82 my-ad.webp`
2. Open `src/data/portfolio.ts`, copy the commented template at the top, paste it into the list, fill it in.
3. `featured: true` puts it on the home page. Order in the list is the order on the page.

Image ads use `media: { kind: 'image', src, width, height }` instead of the video block.

### Change a policy

Edit the `.md` file in `src/pages/policies/`, then update `policiesUpdated` in `src/config/site.ts` so the "Last updated" date is correct.

## Deploy on Vercel (GitHub integration)

1. Create a new GitHub repository and push this folder to it (`node_modules` and `dist` are already ignored).
2. In Vercel: Add New, Project, import the repository. The Astro preset and the settings in `vercel.json` are picked up automatically. No environment variables are needed.
3. Add `cirfan.com` under Project Settings, Domains. Set `www.cirfan.com` to redirect to `cirfan.com`.
4. Every push to `main` deploys to production. Pull requests get preview URLs.

After the first deploy, submit `https://cirfan.com/sitemap-index.xml` in Google Search Console and Bing Webmaster Tools.

## Security notes

- `vercel.json` sends a strict Content-Security-Policy: only files from cirfan.com can load. No inline scripts or styles exist in the build, by design.
- If you later add analytics, a booking widget, a form service or any embed, add its domain to the matching CSP directive (`script-src`, `connect-src`, `frame-src`, `img-src`), or it will be silently blocked.
- HSTS is set with `preload`. Only submit the domain to hstspreload.org once you are sure every subdomain will always use HTTPS.
- Fonts are self-hosted (SIL Open Font License, see `public/fonts/`), so visitors never contact Google.

## Theme behaviour

First visit follows the device setting and keeps following it. Once a visitor uses the switch, the choice is saved in `localStorage` (`cirfan-theme`) and wins from then on. `public/scripts/theme-init.js` applies it before the first paint, so there is no flash.

## Before you launch

- Create the `hello@cirfan.com` mailbox and set up SPF, DKIM and DMARC for the domain.
- Use a Vercel Pro plan. The Hobby plan is for non-commercial use only.
- Re-render the face roller demo: its end card still says "your-domain.com".
- Have a lawyer review the policies, and use a signed service agreement for each client.
- Quebec's Charter of the French language may require a French version of the site.
