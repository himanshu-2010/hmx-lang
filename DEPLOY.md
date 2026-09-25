# Deploying the HMX Web Playground

This repository (`github.com/himanshu-2010/hmx-lang`) deploys as the **HMX web
playground**. The Vite + React + TypeScript app lives in `web-playground/`, and
the deploy signals (`package.json`, `vite.config.ts`, `vercel.json`,
`Procfile`) sit at the repo root — so importing the repo into Vercel or
Antideploy auto-detects it with no "root directory" setting. The native
compiler (`src/`, `tests/`, `examples/`) is not part of the deploy.

## Pick a platform

| | **Antideploy** (preferred) | **Vercel** |
|---|---|---|
| Config | None required — it reads `package.json` + `Procfile` | `vercel.json` (already committed) |
| Auto-deploy | Every push to the default branch | Every push to the production branch |
| Domain | `<name>.antideploy.com` | `<name>.vercel.app`, plus custom domains |
| Custom domains **you own** | Not supported today | Supported |

If you want a domain you actually own (e.g. `hmx.dev`), that only works on
**Vercel** today. Antideploy serves on `*.antideploy.com` subdomains.

## Choose a name (domain)

Your chosen name becomes the subdomain: `hmx.antideploy.com` /
`hmx.vercel.app`. Keep it short, lowercase, no spaces.

| Name | Reads as | Free on both? |
|---|---|---|
| `hmx` | just the language name | ✔ |
| `hmxplay` | HMX play(ground) | ✔ |
| `tryhmx` | try HMX | ✔ |
| `hmxlang` | HMX lang | ✔ |
| `hmx-studio` | the playground as a studio | ✔ |
| `hmxide` | HMX IDE vibe | ✔ |

If you later want to own a real domain, buy one and connect it to Vercel:
`hmx.dev`, `hmxlang.dev`, `playhmx.dev`, `hmxlabs.dev`, `hmx.run`, `hmxplay.dev`.

## Before you start

1. Commit any pending work locally and push — the repo already tracks
   `origin` (`github.com/himanshu-2010/hmx-lang.git`) on branch `main`:

   ```bash
   git add -A
   git commit -m "Deploy web playground from repo root (Antideploy/Vercel)"
   git push origin main
   ```

2. `npm install` locally once so the lockfile is in sync (the lockfile is
   already committed).

## Option A — Antideploy (preferred)

1. Go to [antideploy.com](https://antideploy.com), **New application → GitHub**.
2. Install the Antideploy GitHub App on the account that owns the repo
   (grant it the one repo, not all).
3. Pick the repo. Because the root is buildable, it deploys it directly —
   no directory picker needed.
4. **Review the analysis before deploying.** It should show:
   - Runtime: `Node`
   - Framework: `Vite` (evidence: `vite.config.ts` + `vite` in `package.json`)
   - Build: `npm run build`
   - Start: `node server.mjs` (evidence: `Procfile`)
   - Port: whatever it reports — `server.mjs` honours `$PORT`, so any injected
     port works.
   - No database, no env vars, no warnings that matter.
5. **Deploy.** You get a live HTTPS URL on `*.antideploy.com` in ~36–70s.
6. Every push to the default branch redeploys automatically. A failed build
   keeps the previous version serving.

Folder-upload alternative: **New project → Upload**, drag this folder. It
excludes `node_modules`/`dist`/`.git` itself.

## Option B — Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project**, import the GitHub
   repo.
2. Vercel auto-detects the **Vite** framework from the committed `vercel.json`.
   Nothing to change — framework preset, build command, and output dir
   (`dist/`) are already pinned.
3. **Deploy.** You get `<project>.vercel.app` and can promote the repo's
   default branch for auto-deploys on every push.

## Local smoke test of the prod build

```bash
npm install
npm run build      # tsc -b && vite build → dist/
npm start          # node server.mjs → http://localhost:4173
```

## How the pieces fit

- `vercel.json` — pins framework/build/output for Vercel; also used by the
  Vercel CLI (`vercel --prod`).
- `Procfile` + `server.mjs` + `npm start` — the "listen on a port" contract
  Antideploy requires, honoured via its documented `web:` override.
- Vite is a first-class detected framework on Antideploy; the Procfile just
  removes any doubt about the start command.