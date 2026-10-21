# Understudy website

Static landing page and documentation. No build step.

## Deploy to Vercel

1. Open `assets/site.js` and set `GITHUB_URL` to your repository (one line).
2. On vercel.com: **Add New → Project → Import** your GitHub repository.
3. Set **Root Directory** to `website`, framework **Other**, no build command. Deploy.

Or with the CLI from this folder: `npx vercel --prod`.

## Before each release

1. Version: the `eyebrow` badge in `index.html` and the "New in" callout in `docs/index.html`.
2. Screenshots: retake them (shot list in `../docs/CODEMAP.md`, section 10), save the PNGs in `../docs/screenshots/` for the README, convert them with `../tools/screenshot-webp.html` (Edge/Chrome, offline) and replace the files in `assets/img/` (same names, 2000 × 1250).
3. Push to GitHub. Vercel redeploys by itself; otherwise run `npx vercel --prod` from this folder.

Pages: `/` (landing), `/docs` (documentation), `404.html`. Settings and security headers are in `vercel.json`.
Fonts (Inter, Instrument Serif, JetBrains Mono) are self-hosted under the SIL Open Font License.
