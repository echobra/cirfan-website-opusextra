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
npm run build      # checks copy for em/en dashes, then builds to /dist (needs NEXT_PUBLIC_EMAIL in .env or the environment)
```

## Where to edit things

| What | File |
| --- | --- |
| Business name, social links, policy date, nav, main button text | `src/config/site.ts` |
| Contact email (everywhere) | `NEXT_PUBLIC_EMAIL` environment variable |
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
| `NEXT_PUBLIC_EMAIL` | The site’s contact email, used on every page, in structured data, on client pages and as the reply-to of client emails. Read at build time: change it, then redeploy. The build stops if it’s missing |
| `SLACK_FORM_WEBHOOK` | Slack Incoming Webhook URL for the questionnaire channel |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Dashboard login, matched exactly. Use a long password (20+ characters) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | From Supabase, Project Settings, API. The service role key stays server-side |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 bucket for delivered files |
| `R2_JURISDICTION` | Optional, for example `eu`, only if the bucket was created in a jurisdiction |
| `RESEND_API_KEY`, `NOTIFY_FROM_EMAIL` | Client email updates through Resend. `NOTIFY_FROM_EMAIL` like `cirfan <updates@cirfan.com>` on a domain verified in Resend |
| `SLACK_ADMIN_WEBHOOK` | Optional. Slack webhook for a short summary when a bulk upload finishes (use a private channel) |
| `PORTAL_SESSION_DAYS` | Optional, defaults to 183 (about six months) |
| `SITE_ORIGIN` | Optional, defaults to `https://cirfan.com` |

## One-time setup

### Slack (questionnaire)
Create a Slack app with Incoming Webhooks, add a webhook for the channel that should receive submissions, and put its URL in `SLACK_FORM_WEBHOOK`. Every real submission is posted there labeled 🟢 GOOD FIT or 🔴 NOT A FIT. Spam caught by the hidden trap field is not posted.

### Supabase (database)
Create a new Supabase project for cirfan (keep it separate from other businesses), open the SQL Editor, and run `supabase/schema.sql` once.
Already ran an older `schema.sql`? Run `supabase/migrations/002_folders_archive_notify.sql` instead. It adds folders, the archive, file dimensions and email updates without touching existing data.

### Resend (client email updates)
Create a Resend account, add `cirfan.com` as a sending domain and add the DNS records it shows, then create an API key with Sending access only. Put it in `RESEND_API_KEY` and set `NOTIFY_FROM_EMAIL`. Emails go out once per upload batch, only to clients with a notification email who have created their password and opened their page.

### Cloudflare in front of the site
If cirfan.com is proxied through Cloudflare (orange cloud), the server reads the visitor’s real IP from `cf-connecting-ip`, but only for requests that really come from Cloudflare’s published IP ranges, so it can’t be faked. Vercel advises against putting a proxy in front of it, and Vercel Firewall rate limits then see Cloudflare’s addresses instead of visitors’, so the recommended setup is DNS only (grey cloud) for the records that point to Vercel. If Cloudflare publishes new ranges (https://www.cloudflare.com/ips), update the list in `api/_lib/http.ts`.

While the proxy is on, two more things happen:
- Cloudflare gives up on any request after 100 seconds and shows error 524. Long video conversions hit this; the server keeps working and the file usually appears a minute later, but the dashboard can’t tell you if it succeeded. DNS only removes the limit.
- Cloudflare Web Analytics may inject `static.cloudflareinsights.com/beacon.min.js`. The Content-Security-Policy blocks it (you’ll see a console error), which is correct: the privacy notice says the site uses no analytics. Turn it off in Cloudflare (Analytics & Logs, Web Analytics) rather than allowing it, or update the privacy notice first.

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
2. Upload files, or drop whole folders (or use Upload a folder). A dropped folder becomes a folder on the client page with the same name; subfolders are flattened into it. Each file goes straight from your browser to R2, then the server removes its metadata, checks nothing is left, stores only the clean copy and deletes the original.
   - Videos already in H.264, 8-bit, standard range are remuxed with no quality loss.
   - HEVC/H.265, ProRes, 10-bit, HDR, VP9 and AV1 (phone footage usually is one of these) are converted to H.264 MP4 at CRF 16, capped at 1080 px on the short side, with HDR tone-mapped to standard range. Browsers can’t show many of these formats (you hear audio over a grey box), and HDR looks washed out on normal screens. The upload line and the activity log say when a file was converted.
   - Images: EXIF, XMP, IPTC and text chunks removed with sharp, color profile kept.
   - A file that still carries metadata after cleaning is rejected.
3. Organize with New folder, Move to, Archive and Restore. Archived folders and files appear under the client’s Archive tab.
4. Send the link through the client’s channel. The first person to open it creates the password, so send it only to the client. If anyone else got there first, use Reset password.
5. The client stays signed in for about six months through an HttpOnly cookie. Downloads use signed links that expire after five minutes. Whole folders download as one ZIP built in the browser (written straight to disk on Chrome and Edge), with a short guide to opening ZIP files.
6. After each upload batch, if Email the client is ticked and the client is eligible, one email is sent. Eligible means a notification email is set, updates are on, and the client has created their password and opened the page.
7. Every visit, sign-in, wrong password, click, preview and download (completed or failed) is logged with time, IP and device. Read it per client in `/admin`, filter it, or export it as CSV.

Limits: 200 MB per file, checked before upload (processing holds the original and the clean copy in the function’s 512 MB of temporary space). Uploads run two at a time, but files are processed one at a time so two conversions never share a server’s memory. A 10 second 4K 60 fps HDR phone clip takes roughly a minute to convert; ffmpeg is stopped after 230 seconds and the file is reported as too long. Every failure is shown on its upload line and logged as "File could not be processed" with the reason. Eight wrong passwords in 15 minutes pause sign-in for that page for 15 minutes.

## Bulk upload for several clients

In `/admin`, click Bulk upload for several clients, then drop your client folders (or the one folder that holds them) or use Choose a folder.

```
cirfan-client-work/        dropped as a whole: treated as the container
  acme corp/               goes to the page named “Acme Corp” (case, spaces, dashes and accents ignored)
    oct01-31/              becomes the folder “oct01-31” on that page (added to it if it already exists)
      cinematic-v1.mp4
    hero.png               a file directly in a client folder goes in loose
  mediacrater/
    oct01-31/
      video1.mp4
```

- Nothing is uploaded until you review the plan. Each top folder shows the page it matched. Folders with no match, or more than one, are skipped until you pick a page or choose Create a new page.
- Files already on that page in the same folder are skipped by default, so re-running the same drop after a failure only uploads what is missing.
- Unsupported files, system files (such as .DS_Store) and files over 200 MB are skipped and listed. Folders deeper than one level are merged into their parent folder.
- Clients are processed one after another. As soon as one client’s files are ready, that client gets one email (if they are eligible), then the next client starts. New pages created by a bulk upload are never emailed: send their link yourself, shown in the results.
- Keep the tab open until it says All done: files upload from your computer. The tab title shows progress, closing it asks for confirmation, and the screen is kept awake where the browser supports it. If `SLACK_ADMIN_WEBHOOK` is set, a summary is posted to Slack at the end.

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
