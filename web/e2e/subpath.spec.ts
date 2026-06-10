import { test, expect } from '@playwright/test';

/**
 * Sub-path deployment regression test for issue #13.
 *
 * The app is deployed as a GitHub Pages *project site*
 * (`https://link-assistant.github.io/model-in-browser/`), i.e. under a `/<repo>/`
 * sub-path. The default e2e suite (`inference.spec.ts`) runs against
 * `vite preview`, which serves at the origin root — so it never exercised the
 * sub-path and the bug shipped unnoticed.
 *
 * Issue #13: ONNX Runtime Web's wasm glue (`ort-wasm-simd-threaded.jsep.mjs`)
 * was requested from `<origin>/ort/...` instead of `<origin>/<repo>/ort/...`,
 * because the worker derived the path from `self.location.origin` and dropped
 * the sub-path. The dynamic `import()` 404'd and ORT reported the generic
 * "no available backend found … importing a module script failed".
 *
 * This spec runs against the dedicated sub-path server (`subpath-server.mjs`,
 * wired in as the `chromium-subpath` project's web server) and asserts that:
 *   1. The ORT wasm glue is fetched from the sub-path and returns 200 (not 404).
 *   2. No "no available backend found" error appears.
 *   3. The pinned model loads and reaches the ready state.
 *
 * Determinism: we pin the tiny SmolLM2 135M Instruct at 8-bit via the
 * `?model=&dtype=` override, matching `inference.spec.ts` (small download,
 * robust on the single-threaded WASM/CPU backend).
 *
 * Note: gotos here are RELATIVE (no leading slash) so they resolve against the
 * sub-path `baseURL` configured for this project.
 */

const MODEL_URL = '?model=smollm2-135m-instruct&dtype=q8&debug=1';
const READY = /Instruct ready/;

// The ORT wasm glue module whose mis-resolved URL was the root cause.
const ORT_GLUE = 'ort-wasm-simd-threaded.jsep.mjs';

test.describe('Sub-path deployment (issue #13)', () => {
  test.describe.configure({ mode: 'serial' });

  test('serves ORT wasm from the sub-path and loads without a backend error', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Record every ORT-glue request and the status it resolved to. Before the
    // fix this request 404'd at the origin root; after the fix it must 200 from
    // the sub-path.
    const ortGlueResponses: { url: string; status: number }[] = [];
    page.on('response', (res) => {
      const url = res.url();
      if (url.includes(ORT_GLUE)) {
        ortGlueResponses.push({ url, status: res.status() });
      }
    });

    await page.goto(MODEL_URL);

    // The model auto-loads and must reach the ready state. If the sub-path were
    // dropped, ORT would fail to import its backend and we'd never get here.
    await expect(page.getByText(READY)).toBeVisible({ timeout: 5 * 60 * 1000 });

    // The exact failure mode of issue #13 must not appear.
    const backendError = consoleErrors.find((e) =>
      e.includes('no available backend found')
    );
    expect(
      backendError,
      `Unexpected "no available backend found" error — ORT failed to load its ` +
        `wasm backend. Console errors:\n${consoleErrors.join('\n')}`
    ).toBeUndefined();

    // The ORT glue must have been requested from the sub-path and succeeded.
    expect(
      ortGlueResponses.length,
      'ORT wasm glue was never requested — backend did not initialize'
    ).toBeGreaterThan(0);
    for (const r of ortGlueResponses) {
      expect(
        r.url,
        `ORT glue requested from the wrong path (sub-path dropped): ${r.url}`
      ).toContain('/model-in-browser/ort/');
      expect(
        r.status,
        `ORT glue request did not succeed (${r.status}): ${r.url}`
      ).toBeLessThan(400);
    }

    // No visible error state in the UI.
    await expect(page.getByText(/Error:/i)).not.toBeVisible();
  });
});
