// Static file server for the production build (dist/).
//
// Serves two purposes:
//  1. A `start` command + `Procfile` web: line so Antideploy's container has a
//     process that actually listens on a port (its #1 failure mode is "builds
//     but never listens"); PORT is honoured when the platform injects it.
//  2. `npm start` locally ==  `npm run preview`.
//
// Vercel ignores this file entirely and serves dist/ itself from vercel.json.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function send(res, status, path) {
  res.writeHead(status, {
    "Content-Type": MIME[extname(path)] || "application/octet-stream",
    "Cache-Control": "public, max-age=0, must-revalidate",
  });
  createReadStream(path).pipe(res);
}

createServer((req, res) => {
  let urlPath = "/";
  try {
    urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("Bad Request");
    return;
  }

  let filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(ROOT, "index.html"); // SPA fallback
  }

  if (!existsSync(filePath)) {
    res.writeHead(404).end("Not found — have you run `npm run build`?");
    return;
  }
  send(res, 200, filePath);
}).listen(PORT, () => {
  console.log(`HMX playground serving dist/ on http://0.0.0.0:${PORT}`);
});