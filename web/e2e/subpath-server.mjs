/**
 * Static file server that serves the built `dist/` under a configurable
 * sub-path (default `/model-in-browser/`) with the same cross-origin-isolation
 * headers the app needs, to faithfully mimic a GitHub Pages *project site*
 * deployment (`https://<user>.github.io/<repo>/`) locally.
 *
 * The default Playwright e2e suite runs against `vite preview`, which serves the
 * app at the origin root (`/`). That masked issue #13: ONNX Runtime Web's wasm
 * binaries were requested from `https://host/ort/...` instead of
 * `https://host/<repo>/ort/...`, so the deployed project site failed with
 * "no available backend found". This server reproduces the sub-path so the
 * regression spec (`subpath.spec.ts`) exercises the real deployment layout.
 *
 * Usage: node e2e/subpath-server.mjs [port] [basePath]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');
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
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  // Cross-origin isolation headers (required for threaded WASM), matching the
  // app's production expectations.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!urlPath.startsWith(base)) {
    // Redirect the bare host to the sub-path so opening the root works.
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
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>404</title>Not found');
  }
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Serving ${distDir} at http://localhost:${port}${base}`);
});
