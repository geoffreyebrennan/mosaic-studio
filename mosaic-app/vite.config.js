import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Change 'mosaic-studio' below to match your GitHub repo name if you deploy
// to GitHub Pages under https://<user>.github.io/<repo>/
// If you deploy to Vercel/Netlify (or a custom domain), set base to "/".
export default defineConfig({
  plugins: [react()],
  base: "/mosaic-studio/",
});
