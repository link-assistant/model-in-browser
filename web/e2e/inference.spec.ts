import { test, expect } from '@playwright/test';

/**
 * E2E tests for SmolLM2 browser inference.
 *
 * These tests verify that the WASM-based language model can:
 * 1. Load successfully in the browser (automatic download)
 * 2. Generate text responses without errors
 * 3. Stream tokens back to the UI
 * 4. Handle multiple consecutive messages without errors
 *
 * Note: These tests require significant time due to:
 * - Model download (~270MB)
 * - WASM compilation
 * - Inference computation
 */

test.describe('SmolLM2 Browser Inference', () => {
  // Run tests serially since they share model state
  test.describe.configure({ mode: 'serial' });

  test('should display initial UI correctly', async ({ page }) => {
    await page.goto('/');

    // Check header
    await expect(page.getByRole('heading', { name: 'SmolLM2 in Browser' })).toBeVisible();
    await expect(
      page.getByText('AI language model running entirely on your device via WebAssembly')
    ).toBeVisible();

    // Check initial message (updated for automatic loading)
    await expect(
      page.getByText(/Hello! I'm SmolLM2, a small language model running entirely in your browser/)
    ).toBeVisible();

    // Check footer info
    await expect(page.getByText(/No data sent to servers/)).toBeVisible();

    // Model should start auto-loading - check for loading indicators
    await expect(page.getByText(/Initializing|Starting automatic download|Downloading/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test('should load model automatically without button click', async ({ page }) => {
    await page.goto('/');

    // Should show loading status automatically (no button click needed)
    await expect(page.getByText(/Initializing|Starting automatic download|Downloading|Loading/i)).toBeVisible({
      timeout: 10000,
    });

    // Wait for model to be ready (this can take several minutes)
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    // Message input should be enabled
    await expect(page.locator('.cs-message-input__content-editor')).toBeEnabled();
  });

  test('should generate text response without errors', async ({ page }) => {
    await page.goto('/');

    // Listen for console errors from the start
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for model to auto-load
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    // Send a message
    const messageInput = page.locator('.cs-message-input__content-editor');
    await messageInput.fill('Hello');
    await messageInput.press('Enter');

    // Should show user message
    await expect(page.getByText('Hello').first()).toBeVisible();

    // Wait for generation to complete (typing indicator should appear then disappear)
    // The response should appear within 2 minutes
    await expect(page.getByText('SmolLM2 is thinking...')).toBeVisible({ timeout: 10000 });

    // Wait for typing indicator to disappear (generation complete)
    await expect(page.getByText('SmolLM2 is thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Check for the critical error that was reported in issue #5
    const repeatPenaltyError = consoleErrors.find((e) =>
      e.includes('Repeat penalty failed: unexpected rank')
    );
    expect(repeatPenaltyError).toBeUndefined();

    // There should be no error status
    await expect(page.getByText(/Error:/i)).not.toBeVisible();

    // Status should still be "Model ready" (not error state)
    await expect(page.getByText('Model ready')).toBeVisible();
  });

  test('should stream tokens to the UI', async ({ page }) => {
    await page.goto('/');

    // Wait for model to auto-load
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    // Send a message
    const messageInput = page.locator('.cs-message-input__content-editor');
    await messageInput.fill('Count from 1 to 5');
    await messageInput.press('Enter');

    // Wait for generation to complete
    await expect(page.getByText('SmolLM2 is thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SmolLM2 is thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // There should be multiple AI response regions (initial greeting + new response)
    const aiMessages = page.locator('[class*="cs-message--incoming"]');
    await expect(aiMessages).toHaveCount(2, { timeout: 5000 });
  });

  test('should handle multiple consecutive messages without errors (issue #7)', async ({ page }) => {
    await page.goto('/');

    // Listen for console errors from the start - this is crucial for detecting the broadcast error
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for model to auto-load
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    const messageInput = page.locator('.cs-message-input__content-editor');

    // Send FIRST message
    await messageInput.fill('Say hello');
    await messageInput.press('Enter');

    // Wait for first generation to complete
    await expect(page.getByText('SmolLM2 is thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SmolLM2 is thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Verify no errors after first message
    await expect(page.getByText(/Error:/i)).not.toBeVisible();
    await expect(page.getByText('Model ready')).toBeVisible();

    // Send SECOND message - this is where the original bug occurred
    await messageInput.fill('Say goodbye');
    await messageInput.press('Enter');

    // Wait for second generation to complete
    await expect(page.getByText('SmolLM2 is thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SmolLM2 is thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Check for the broadcast error that was the root cause of issue #7
    const broadcastError = consoleErrors.find((e) =>
      e.includes('cannot broadcast') || e.includes('Forward pass failed')
    );
    expect(broadcastError).toBeUndefined();

    // Verify no errors after second message
    await expect(page.getByText(/Error:/i)).not.toBeVisible();
    await expect(page.getByText('Model ready')).toBeVisible();

    // Send THIRD message to ensure continued stability
    await messageInput.fill('How are you?');
    await messageInput.press('Enter');

    // Wait for third generation to complete
    await expect(page.getByText('SmolLM2 is thinking...')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('SmolLM2 is thinking...')).not.toBeVisible({
      timeout: 2 * 60 * 1000,
    });

    // Final verification - no errors after three consecutive messages
    const anyBroadcastError = consoleErrors.find((e) =>
      e.includes('cannot broadcast') || e.includes('Forward pass failed')
    );
    expect(anyBroadcastError).toBeUndefined();

    await expect(page.getByText(/Error:/i)).not.toBeVisible();
    await expect(page.getByText('Model ready')).toBeVisible();

    // There should be 4 AI response regions (initial greeting + 3 responses)
    const aiMessages = page.locator('[class*="cs-message--incoming"]');
    await expect(aiMessages).toHaveCount(4, { timeout: 5000 });
  });
});

test.describe('Error Handling', () => {
  test('should handle model loading gracefully', async ({ page }) => {
    await page.goto('/');

    // Model starts loading automatically
    await expect(page.getByText(/Initializing|Starting automatic download|Downloading/i)).toBeVisible({
      timeout: 10000,
    });

    // Page should remain responsive
    await expect(page.getByRole('heading', { name: 'SmolLM2 in Browser' })).toBeVisible();
  });
});
