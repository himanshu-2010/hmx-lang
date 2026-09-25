import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app lives in web-playground/; this file lives at the repo root so
// Vercel/Antideploy see a buildable root (package.json + vite.config.ts).
// `root` points Vite at the app; the build lands in ../dist (repo root) as
// vercel.json expects.
export default defineConfig({
  root: 'web-playground',
  plugins: [react()],
  build: {
    outDir: '../dist',
  },
})