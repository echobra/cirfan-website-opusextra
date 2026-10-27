<!-- README.md -->
# cirfan.com

Marketing site, questionnaire, private client delivery pages and an admin dashboard for cirfan, an AI image and video ad studio.
Built with [Astro](https://astro.build) (static pages) plus three Vercel Functions in `api/` and one Routing Middleware (`middleware.ts`).

## Run it locally

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev        # pages only, http://localhost:4321
npx vercel dev     # pages + api/ + middleware, http://localhost:3000 (run `npx vercel env pull .env.local` first)
npm run build      # checks copy for em/en dashes, then builds to /dist
```

## Where to edit things

| What | File |
| --- | --- |
| Business name, email, social links, policy date, nav, main button text | `src/config/site.ts` |
| Portfolio pieces (home shows the first 2 with `featured: true`) | `src/data/portfolio.ts` |
| Questionnaire questions, answers, disqualifiers, flags | `src/data/questionnaire.js` |
| Home page copy | `src/pages/index.astro` (arrays at the top) |
| "What to expect as a client" page | `src/pages/working-together.astro` |
| Policies (plain Markdown) | `src/pages/policies/*.md` |
| Colors, fonts, spacing | `src/styles/global.css` |
| Questionnaire to Slack | `api/fit.ts` |
| Admin dashboard (page / script / API) | `src/pages/admin.astro`, `src/scripts/admin.ts`, `api/admin.ts` |
| Client delivery page (page / script / API) | `src/pages/client.astro`, `src/scripts/portal.ts`, `api/portal.ts` |
| Metadata removal | `api/_lib/strip.ts` |
| Database tables | `supabase/schema.sql` |
| Security headers, rewrites, function limits | `vercel.json` |

## Environment variables

Set these in Vercel, Project Settings, Environment Variables, for Production and Preview. Never commit them.

| Name | What it is |
| --- | --- |
| `SLACK_FORM_WEBHOOK` | Slack Incoming Webhook URL for the questionnaire channel |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Dashboard login, matched exactly. Use a long password (20+ characters) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | From Supabase, Project Settings, API. The service role key stays server-side |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 bucket for delivered files |
| `R2_JURISDICTION` | Optional, for example `eu`, only if the bucket was created in a jurisdiction |
| `PORTAL_SESSION_DAYS` | Optional, defaults to 183 (about six months) |
| `SITE_ORIGIN` | Optional, defaults to `https://cirfan.com` |

## One-time setup

### Slack (questionnaire)
Create a Slack app with Incoming Webhooks, add a webhook for the channel that should receive submissions, and put its URL in `SLACK_FORM_WEBHOOK`. Every real submission is posted there labeled 🟢 GOOD FIT or 🔴 NOT A FIT. Spam caught by the hidden trap field is not posted.

### Supabase (database)
Create a new Supabase project for cirfan (keep it separate from other businesses), open the SQL Editor, and run `supabase/schema.sql` once.

### Cloudflare R2 (files)
1. Create a private bucket (no public access, no custom domain), for example `cirfan-deliveries`.
2. Create an R2 API token with Object Read & Write on that bucket only.
3. Bucket Settings, CORS policy:
   ```json
   [
     {
       "AllowedOrigins": ["https://cirfan.com", "https://www.cirfan.com"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["content-length", "etag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Add `http://localhost:3000` while testing with `vercel dev`, and your preview domain if you upload from previews.
4. Bucket Settings, Object lifecycle rules: delete objects with prefix `incoming/` after 1 day (cleans up abandoned uploads).

### Vercel Firewall
Add rate limit rules for `/api/fit`, `/api/portal` and `/admin` (for example 20 requests per minute per IP).

## How the client pages work

1. In `/admin`, click New page. A link like `https://cirfan.com/c/acme-skin-co-k3j9x2m8q4ab` is created at once.
2. Upload files. Each one goes straight from your browser to R2, then the server removes its metadata (ffmpeg remux for video, no quality loss; sharp for images), checks nothing is left, stores only the clean copy and deletes the original. A file that still carries metadata after cleaning is rejected.
3. Send the link through the client’s channel. The first person to open it creates the password, so send it only to the client. If anyone else got there first, use Reset password.
4. The client stays signed in for about six months through an HttpOnly cookie. Downloads use signed links that expire after five minutes.
5. Every visit, sign-in, wrong password, click, preview and download (completed or failed) is logged with time, IP and device. Read it per client in `/admin`, filter it, or export it as CSV.

Limits: 200 MB per file (processing holds the original and the clean copy in the function’s 512 MB of temporary space). Eight wrong passwords in 15 minutes pause sign-in for that page for 15 minutes.

## Deploy on Vercel (GitHub integration)

Push to the GitHub repository connected to Vercel. Every push to `main` deploys to production; pull requests get preview URLs. After the first deploy, submit `https://cirfan.com/sitemap-index.xml` in Google Search Console and Bing Webmaster Tools.

## Security notes

- Strict Content-Security-Policy in `vercel.json`: only cirfan.com plus R2 signed URLs (`*.r2.cloudflarestorage.com`) may load. No inline scripts or styles exist in the build. If you add analytics, a widget or an embed, add its domain to the matching directive or it will be blocked.
- The dashboard is protected twice: the browser login prompt from `middleware.ts`, and the same check inside `api/admin.ts`, so a misconfigured middleware cannot expose data.
- Server functions only accept requests whose Origin is cirfan.com or its Vercel URLs, validate every input against an allow list, and never return storage keys or the service role key.
- Client page passwords are hashed with scrypt; session tokens are stored only as SHA-256 hashes.
- `.gitignore` keeps `.env*`, `node_modules` and `dist` out of git. Keep it in the repository.
- Fonts are self-hosted (SIL Open Font License, see `public/fonts/`).

## Theme behaviour

First visit follows the device setting and keeps following it. Once a visitor uses the switch, the choice is saved in `localStorage` (`cirfan-theme`). `public/scripts/theme-init.js` applies it before the first paint.

## Before you launch

- Use a Vercel Pro plan. The Hobby plan is for non-commercial use only.
- Have a lawyer review the policies, and use a signed service agreement for each client.
- Quebec’s Charter of the French language may require a French version of the site.
