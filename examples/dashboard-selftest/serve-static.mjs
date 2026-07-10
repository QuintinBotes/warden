// Minimal, self-contained static server for the Warden dashboard's static export.
// Rooted at apps/dashboard/out so the export's absolute asset paths (/_next/...) resolve —
// exactly what a file:// open cannot do. Started/torn down by Playwright's webServer.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// examples/dashboard-selftest/ -> repo root -> apps/dashboard/out
const ROOT = resolve(
  process.env.WARDEN_DASHBOARD_OUT ?? join(HERE, '..', '..', 'apps', 'dashboard', 'out'),
);
const PORT = Number(process.env.PORT ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', // browsers refuse to APPLY css served as anything else
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
    if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';

    // Resolve within ROOT only — reject traversal.
    const filePath = normalize(join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + '/')) {
      res.writeHead(403).end('forbidden');
      return;
    }

    // Read directly and handle errors — no stat() first, to avoid a check-then-use (TOCTOU) race.
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      // ENOENT (missing) or EISDIR (a directory) → not found.
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[serve-static] dashboard export at http://127.0.0.1:${PORT} (root: ${ROOT})`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
