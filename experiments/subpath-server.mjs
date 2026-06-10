/**
 * Tiny static file server that serves web/dist under a configurable sub-path
 * (default `/model-in-browser/`) with the same cross-origin-isolation headers
 * the app uses, to mimic a GitHub Pages project-site deployment locally.
 *
 * Usage: node experiments/subpath-server.mjs [port] [basePath]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'web', 'dist');
const port = Number(process.argv[2] || 4180);
const base = process.argv[3] || '/model-in-browser/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const setCors = () => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  };
  setCors();

  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!urlPath.startsWith(base)) {
    // Redirect root to the sub-path so opening the bare host works.
    if (urlPath === '/') {
      res.writeHead(302, { Location: base });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('Not found (outside base path)');
    return;
  }
  let rel = urlPath.slice(base.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const filePath = normalize(join(distDir, rel));
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) throw new Error('dir');
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>404</title>Not found');
  }
});

server.listen(port, () => {
  console.log(`Serving ${distDir} at http://localhost:${port}${base}`);
});
