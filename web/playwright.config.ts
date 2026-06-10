import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for e2e testing SmolLM2 browser inference.
 * @see https://playwright.dev/docs/test-configuration
 *
 * Two projects run against two servers:
 *  - `chromium`         — the app served at the origin root by `vite preview`
 *                         (port 4173). Runs the main inference suite.
 *  - `chromium-subpath` — the built `dist/` served under `/model-in-browser/`
 *                         by `e2e/subpath-server.mjs` (port 4180), reproducing
 *                         the GitHub Pages project-site layout. Runs the issue
 *                         #13 sub-path regression spec, which the root-served
 *                         suite structurally cannot catch.
 */
const SUBPATH_BASE_URL = 'http://localhost:4180/model-in-browser/';

export default defineConfig({
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI for stability with WASM */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use */
  reporter: process.env.CI ? 'github' : 'html',
  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:4173',
    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
  },
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      /* The sub-path spec runs under its own project/server below. */
      testIgnore: ['**/subpath.spec.ts'],
    },
    {
      name: 'chromium-subpath',
      testMatch: ['**/subpath.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_SUBPATH_BASE_URL || SUBPATH_BASE_URL,
      },
    },
    /* Firefox doesn't fully support all WASM features yet */
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    /* WebKit (Safari) testing */
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
  /* Run your local dev/preview servers before starting the tests. The sub-path
     server reproduces a GitHub Pages project-site deployment (see issue #13). */
  webServer: [
    {
      command: 'npm run preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
    {
      command: 'node e2e/subpath-server.mjs 4180 /model-in-browser/',
      url: SUBPATH_BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
    },
  ],
  /* Global timeout for each test - WASM loading can be slow */
  timeout: 5 * 60 * 1000, // 5 minutes
  /* Expect timeout for assertions */
  expect: {
    timeout: 60 * 1000, // 1 minute for model loading assertions
  },
});
