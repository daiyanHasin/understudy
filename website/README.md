# Understudy website

Static landing page and documentation. No build step.

## Deploy to Vercel

1. Open `assets/site.js` and set `GITHUB_URL` to your repository (one line).
2. On vercel.com: **Add New → Project → Import** your GitHub repository.
3. Set **Root Directory** to `website`, framework **Other**, no build command. Deploy.

Or with the CLI from this folder: `npx vercel --prod`.

Pages: `/` (landing), `/docs` (documentation), `404.html`. Settings and security headers are in `vercel.json`.
Fonts (Inter, Instrument Serif, JetBrains Mono) are self-hosted under the SIL Open Font License.
