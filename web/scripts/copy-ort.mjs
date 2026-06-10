/**
 * Copy ONNX Runtime Web's wasm binaries from the installed
 * `@huggingface/transformers` package into `public/ort/` so the app can serve
 * them same-origin.
 *
 * Why: Transformers.js loads the ORT wasm backend at runtime. By default it
 * fetches the binaries from a CDN (jsdelivr). Serving them locally instead:
 *   - works under cross-origin isolation (COOP/COEP) without CORP headaches,
 *   - works fully offline / in CI without a CDN round-trip,
 *   - pins the wasm to the exact version we ship.
 *
 * The worker points `env.backends.onnx.wasm.wasmPaths` at `./ort/` (see
 * `worker.ts`). This file is generated, not committed (see .gitignore).
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const srcDir = join(webRoot, 'node_modules', '@huggingface', 'transformers', 'dist');
const destDir = join(webRoot, 'public', 'ort');

if (!existsSync(srcDir)) {
  console.error(
    `[copy-ort] Source not found: ${srcDir}\n` +
      'Run `npm install` first so @huggingface/transformers is present.'
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });

// Copy every ORT wasm binary (and the jsep .mjs glue) so whichever variant ORT
// selects at runtime (threaded / simd / jsep) is available locally.
const wanted = readdirSync(srcDir).filter(
  (f) => f.startsWith('ort-wasm') && (f.endsWith('.wasm') || f.endsWith('.mjs'))
);

if (wanted.length === 0) {
  console.error(`[copy-ort] No ort-wasm* files found in ${srcDir}`);
  process.exit(1);
}

for (const file of wanted) {
  copyFileSync(join(srcDir, file), join(destDir, file));
}

console.log(`[copy-ort] Copied ${wanted.length} ORT wasm file(s) to public/ort/`);
