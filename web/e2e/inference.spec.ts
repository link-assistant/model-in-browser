import { test, expect } from '@playwright/test';

/**
 * E2E tests for in-browser language model inference.
 *
 * These tests verify that the Transformers.js (ONNX Runtime Web) engine can:
 * 1. Detect the device and auto-load a model that fits
 * 2. Generate text responses without errors
 * 3. Stream tokens back to the UI
 * 4. Handle multiple consecutive messages without errors
 *
 * Determinism: which model is *recommended* depends on the device's memory
 * budget and on live HuggingFace popularity, so the tests pin a specific model
 * and quantization via the `?model=&dtype=` URL override. We use the tiny
 * SmolLM2 135M Instruct at 8-bit — small to download (~137 MB) and robust on the
 * single-threaded WASM/CPU backend used in CI (no WebGPU, no cross-origin
 * isolation under `vite preview`).
 *
 * Note: These tests require significant time due to:
 * - Model download (~137 MB ONNX for the 135M q8 model)
 * - WASM compilation
 * - Inference computation
 */

// Deterministic load: pin the model + quantization so the test never depends on
// the device-specific recommendation or live Hub data.
const MODEL_URL = '/?model=smollm2-135m-instruct&dtype=q8';

// Status text shown once the pinned model has finished loading
// (e.g. "SmolLM2 135M Instruct ready").
const READY = /Instruct ready/;
// Status text shown while the device is being probed or a model downloads.
// Matched against the dedicated status indicator (`data-testid="status-text"`)
// rather than the whole page, so model-card copy that happens to contain words
// like "loading" or "engine" can't trigger a strict-mode multiple-match.
const LOADING = /Detecting|Loading|Downloading|Generating|engine/i;

test.describe('In-Browser Inference', () => {
  // Run tests serially since they share model state
  test.describe.configure({ mode: 'serial' });

  test('should display initial UI correctly', async ({ page }) => {
    await page.goto(MODEL_URL);

    // Check header
    await expect(page.getByRole('heading', { name: 'Models in Browser' })).toBeVisible();
    await expect(
      page.getByText(/Small AI language models running entirely on your device/)
    ).toBeVisible();

    // Check initial message
    await expect(
      page.getByText(/Hello! I'm a small language model running entirely in your browser/)
    ).toBeVisible();

    // The device-aware model selector should be present
    await expect(page.getByTestId('model-selector')).toBeVisible();
    await expect(page.getByTestId('device-summary')).toBeVisible();

    // Check footer info
    await expect(page.getByText(/No data sent to servers/)).toBeVisible();

    // The pinned model should auto-load and become ready. (We assert the stable
    // end-state rather than a transient "loading" status, which can flash by too
    // quickly to observe once model files are cached.)
    await expect(page.getByText(READY)).toBeVisible({ timeout: 5 * 60 * 1000 });
  });

  test('should load the recommended model automatically without button click', async ({ page }) => {
    await page.goto(MODEL_URL);

    // Should show loading status automatically (no button click needed)
    await expect(page.getByTestId('status-text')).toHaveText(LOADING, {
      timeout: 10000,
    });

    // Wait for model to be ready (this can take several minutes)
    await expect(page.getByText(READY)).toBeVisible({
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    // Message input should be enabled
    await expect(page.getByTestId('composer-input')).toBeEnabled();
  });

  test('should generate text response without errors', async ({ page }) => {
    await page.goto(MODEL_URL);

    // Listen for console errors from the start
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for model to auto-load
    await expect(page.getByText(READY)).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    // Send a message
    const messageInput = page.getByTestId('composer-input');
    await messageInput.fill('Hello');
    await messageInput.press('Enter');

    // Should show user message
    await expect(page.getByText('Hello').first()).toBeVisible();

    // Wait for generation to complete (typing indicator should appear then disappear)
    await expect(page.getByText('Thinking...')).toBeVisible({ timeout: 10000 });

    // Wait for typing indicator to disappear (generation complete)
    await expect(page.getByText('Thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Check for the critical error that was reported in issue #5
    const repeatPenaltyError = consoleErrors.find((e) =>
      e.includes('Repeat penalty failed: unexpected rank')
    );
    expect(repeatPenaltyError).toBeUndefined();

    // There should be no error status
    await expect(page.getByText(/Error:/i)).not.toBeVisible();

    // Status should still be "ready" (not error state)
    await expect(page.getByText(READY)).toBeVisible();
  });

  test('should stream tokens to the UI', async ({ page }) => {
    await page.goto(MODEL_URL);

    // Wait for model to auto-load
    await expect(page.getByText(READY)).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    // Send a message
    const messageInput = page.getByTestId('composer-input');
    await messageInput.fill('Count from 1 to 5');
    await messageInput.press('Enter');

    // Wait for generation to complete
    await expect(page.getByText('Thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // There should be multiple AI response regions (initial greeting + new response)
    const aiMessages = page.getByTestId('message-assistant');
    await expect(aiMessages).toHaveCount(2, { timeout: 5000 });
  });

  test('should handle multiple consecutive messages without errors (issue #7)', async ({ page }) => {
    await page.goto(MODEL_URL);

    // Listen for console errors from the start - this is crucial for detecting the broadcast error
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for model to auto-load
    await expect(page.getByText(READY)).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    const messageInput = page.getByTestId('composer-input');

    // Send FIRST message
    await messageInput.fill('Say hello');
    await messageInput.press('Enter');

    // Wait for first generation to complete
    await expect(page.getByText('Thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Verify no errors after first message
    await expect(page.getByText(/Error:/i)).not.toBeVisible();
    await expect(page.getByText(READY)).toBeVisible();

    // Send SECOND message - this is where the original bug occurred
    await messageInput.fill('Say goodbye');
    await messageInput.press('Enter');

    // Wait for second generation to complete
    await expect(page.getByText('Thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Check for the broadcast error that was the root cause of issue #7
    const broadcastError = consoleErrors.find((e) =>
      e.includes('cannot broadcast') || e.includes('Forward pass failed')
    );
    expect(broadcastError).toBeUndefined();

    // Verify no errors after second message
    await expect(page.getByText(/Error:/i)).not.toBeVisible();
    await expect(page.getByText(READY)).toBeVisible();

    // Send THIRD message to ensure continued stability
    await messageInput.fill('How are you?');
    await messageInput.press('Enter');

    // Wait for third generation to complete
    await expect(page.getByText('Thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Final verification - no errors after three consecutive messages
    const anyBroadcastError = consoleErrors.find((e) =>
      e.includes('cannot broadcast') || e.includes('Forward pass failed')
    );
    expect(anyBroadcastError).toBeUndefined();

    await expect(page.getByText(/Error:/i)).not.toBeVisible();
    await expect(page.getByText(READY)).toBeVisible();

    // There should be 4 AI response regions (initial greeting + 3 responses)
    const aiMessages = page.getByTestId('message-assistant');
    await expect(aiMessages).toHaveCount(4, { timeout: 5000 });
  });
});

test.describe('Error Handling', () => {
  test('should handle model loading gracefully', async ({ page }) => {
    await page.goto(MODEL_URL);

    // Model starts loading automatically
    await expect(page.getByTestId('status-text')).toHaveText(LOADING, {
      timeout: 10000,
    });

    // Page should remain responsive
    await expect(page.getByRole('heading', { name: 'Models in Browser' })).toBeVisible();
  });
});
