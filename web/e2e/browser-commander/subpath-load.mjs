/**
 * browser-commander e2e test for issue #13 (sub-path deployment).
 *
 * Requirement: an automated end-to-end test for at least one small instruct
 * model, driven by browser-commander
 * (https://github.com/link-foundation/browser-commander), a universal browser
 * automation library that wraps Playwright via a unified, navigation-aware API.
 *
 * Unlike the Playwright-runner spec (`subpath.spec.ts`), this is a standalone
 * Node script: it spins up the sub-path static server itself, drives a real
 * Chromium through browser-commander, and asserts the issue-#13 failure mode is
 * gone. It is intentionally self-contained so it can run outside the Playwright
 * test runner.
 *
 * What it verifies (GitHub Pages project-site layout, `/<repo>/`):
 *   1. ONNX Runtime Web's wasm glue (`ort-wasm-simd-threaded.jsep.mjs`) is
 *      fetched from the sub-path and returns < 400 (not a 404 at the root).
 *   2. No "no available backend found" error is logged.
 *   3. The pinned small instruct model (SmolLM2 135M Instruct, q8) reaches the
 *      ready state.
 *
 * Usage:
 *   node e2e/browser-commander/subpath-load.mjs
 * Prerequisites:
 *   - `npm run build` has produced `dist/` (with `dist/ort/...`).
 *   - Chromium is installed (`npx playwright install chromium`).
 *
 * Exit code 0 = pass, 1 = fail.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { launchBrowser, makeBrowserCommander } from 'browser-commander';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BC_PORT || 4181);
const BASE = '/model-in-browser/';
const APP_URL = `http://localhost:${PORT}${BASE}?model=smollm2-135m-instruct&dtype=q8&debug=1`;
const ORT_GLUE = 'ort-wasm-simd-threaded.jsep.mjs';
const READY_RE = /Instruct ready/;
const READY_TIMEOUT_MS = 5 * 60 * 1000;

/** Start the sub-path static server (serves ../dist under BASE). */
function startSubpathServer() {
  const serverPath = join(here, '..', 'subpath-server.mjs');
  const child = spawn('node', [serverPath, String(PORT), BASE], {
    cwd: join(here, '..', '..'),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    const onData = (buf) => {
      if (buf.toString().includes('Serving')) {
        child.stdout.off('data', onData);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) =>
      reject(new Error(`subpath server exited early with code ${code}`))
    );
    setTimeout(() => reject(new Error('subpath server did not start in time')), 15000);
  });
}

async function main() {
  const failures = [];
  let server;
  let browser;
  let userDataDir;
  let commander;

  try {
    server = await startSubpathServer();
    console.log(`[bc-e2e] sub-path server up at http://localhost:${PORT}${BASE}`);

    userDataDir = await mkdtemp(join(tmpdir(), 'bc-mib-'));
    ({ browser } = await launchBrowser({
      engine: 'playwright',
      headless: true,
      slowMo: 0,
      userDataDir,
      // --no-sandbox keeps the test runnable as root in CI.
      args: ['--no-sandbox'],
    }));
    const page = browser.pages()[0];
    commander = makeBrowserCommander({ page, verbose: false });

    // Capture console errors and ORT-glue responses on the raw Playwright page.
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    const ortGlueResponses = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes(ORT_GLUE)) ortGlueResponses.push({ url, status: res.status() });
    });

    // Navigate through browser-commander's navigation-aware goto.
    console.log(`[bc-e2e] navigating to ${APP_URL}`);
    await commander.goto({ url: APP_URL, timeout: 60000 });

    // Poll for the ready status text.
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < deadline) {
      const body = await page.evaluate(() => document.body?.innerText || '');
      if (READY_RE.test(body)) {
        ready = true;
        break;
      }
      if (consoleErrors.some((e) => e.includes('no available backend found'))) {
        break; // fail fast — the issue-#13 error appeared
      }
      await sleep(2000);
    }

    // --- Assertions ---
    if (!ready) {
      failures.push(
        `Model never reached the ready state within ${READY_TIMEOUT_MS / 1000}s`
      );
    }
    const backendError = consoleErrors.find((e) =>
      e.includes('no available backend found')
    );
    if (backendError) {
      failures.push(`"no available backend found" error appeared: ${backendError}`);
    }
    if (ortGlueResponses.length === 0) {
      failures.push('ORT wasm glue was never requested — backend did not initialize');
    }
    for (const r of ortGlueResponses) {
      if (!r.url.includes(`${BASE}ort/`)) {
        failures.push(`ORT glue requested from the wrong path (sub-path dropped): ${r.url}`);
      }
      if (r.status >= 400) {
        failures.push(`ORT glue request failed (${r.status}): ${r.url}`);
      }
    }

    if (ortGlueResponses.length) {
      console.log('[bc-e2e] ORT glue responses:');
      for (const r of ortGlueResponses) console.log(`  ${r.status} ${r.url}`);
    }
  } catch (err) {
    failures.push(`Unexpected error: ${err?.stack || err}`);
  } finally {
    try {
      if (commander) await commander.destroy();
    } catch { /* ignore */ }
    try {
      if (browser) await browser.close();
    } catch { /* ignore */ }
    try {
      if (server) server.kill('SIGTERM');
    } catch { /* ignore */ }
    try {
      if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }

  if (failures.length) {
    console.error('\n[bc-e2e] FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n[bc-e2e] PASS — model loaded under sub-path with no backend error.');
  process.exit(0);
}

main();
