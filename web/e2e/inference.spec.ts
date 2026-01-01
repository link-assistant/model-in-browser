import { test, expect } from '@playwright/test';

/**
 * E2E tests for SmolLM2 browser inference.
 *
 * These tests verify that the WASM-based language model can:
 * 1. Load successfully in the browser
 * 2. Generate text responses without errors
 * 3. Stream tokens back to the UI
 *
 * Note: These tests require significant time due to:
 * - Model download (~270MB)
 * - WASM compilation
 * - Inference computation
 */

test.describe('SmolLM2 Browser Inference', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Verify initial state
    await expect(page.getByRole('heading', { name: 'SmolLM2 in Browser' })).toBeVisible();
    await expect(page.getByText('Model not loaded')).toBeVisible();
  });

  test('should display initial UI correctly', async ({ page }) => {
    // Check header
    await expect(page.getByRole('heading', { name: 'SmolLM2 in Browser' })).toBeVisible();
    await expect(
      page.getByText('AI language model running entirely on your device via WebAssembly')
    ).toBeVisible();

    // Check load button
    await expect(page.getByRole('button', { name: /Load Model/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Load Model/i })).toBeEnabled();

    // Check initial message
    await expect(
      page.getByText(/Hello! I'm SmolLM2, a small language model running entirely in your browser/)
    ).toBeVisible();

    // Check footer info
    await expect(page.getByText(/No data sent to servers/)).toBeVisible();
  });

  test('should load model successfully', async ({ page }) => {
    // Click load button
    await page.getByRole('button', { name: /Load Model/i }).click();

    // Should show loading status
    await expect(page.getByText(/Initializing|Downloading|Loading/i)).toBeVisible({
      timeout: 10000,
    });

    // Wait for model to be ready (this can take several minutes)
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000, // 5 minutes
    });

    // Load button should be gone
    await expect(page.getByRole('button', { name: /Load Model/i })).not.toBeVisible();

    // Message input should be enabled
    await expect(page.locator('.cs-message-input__content-editor')).toBeEnabled();
  });

  test('should generate text response without errors', async ({ page }) => {
    // Load the model first
    await page.getByRole('button', { name: /Load Model/i }).click();
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    // Listen for console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
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
    // Load the model first
    await page.getByRole('button', { name: /Load Model/i }).click();
    await expect(page.getByText('Model ready')).toBeVisible({
      timeout: 5 * 60 * 1000,
    });

    // Track token events
    let tokenCount = 0;
    page.on('console', (msg) => {
      // The worker posts 'token' messages which get logged
      if (msg.text().includes('SmolLM2') && msg.type() === 'log') {
        tokenCount++;
      }
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
});

test.describe('Error Handling', () => {
  test('should handle model loading gracefully', async ({ page }) => {
    await page.goto('/');

    // Click load button
    await page.getByRole('button', { name: /Load Model/i }).click();

    // Should not crash immediately
    await expect(page.getByText(/Initializing|Downloading/i)).toBeVisible({
      timeout: 10000,
    });

    // Page should remain responsive
    await expect(page.getByRole('heading', { name: 'SmolLM2 in Browser' })).toBeVisible();
  });
});
