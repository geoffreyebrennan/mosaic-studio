# Mosaic Studio

Image → color-by-number mosaic generator. React + Vite + Tailwind, no backend.

## Run locally

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Deploy to GitHub Pages (recommended, free, zero servers)

1. Create a new GitHub repo, e.g. `mosaic-studio`.
2. In `vite.config.js`, set `base: "/mosaic-studio/"` to match your repo name exactly (already set — just rename if your repo name differs).
3. Push this project:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/mosaic-studio.git
   git push -u origin main
   ```
4. In the repo on GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
5. The included workflow (`.github/workflows/deploy.yml`) builds and deploys automatically on every push to `main`. Check the **Actions** tab for progress.
6. Your app will be live at `https://<your-username>.github.io/mosaic-studio/`.

## Deploy to Vercel or Netlify (alternative, also free)

Both auto-detect Vite. Steps are basically identical for either:

1. Push the repo to GitHub (steps 1–3 above, repo name doesn't matter here).
2. In `vite.config.js`, change `base: "/mosaic-studio/"` to `base: "/"`.
3. Import the repo in Vercel or Netlify's dashboard — build command `npm run build`, output directory `dist`. Both are auto-detected, so you usually just click "Deploy."

## Notes

- Everything runs client-side (image processing, color quantization, PNG/SVG export) — there's no server or API, so hosting is just serving static files.
- The only dependency beyond React is `lucide-react` for icons.
