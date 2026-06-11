import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * E2E tests for the issue #15 chat UX: a persistent three-panel layout, multiple
 * selectable chat engines, conversation management, and Links Notation (.lino)
 * export/import.
 *
 * These tests deliberately do NOT load a model — they exercise the shell,
 * storage, and engine wiring, which is fast and deterministic. The actual
 * send→response guarantee (R6) lives in `inference.spec.ts`, which pins a small
 * model and asserts a streamed reply.
 *
 * `?model=__none__` is an unknown id, so the auto-loader finds no entry and the
 * app stays on the chat shell without kicking off a multi-hundred-MB download.
 */
const SHELL_URL = '/?model=__none__';

// The engines wired into the selector. formal-ai is the default; the rest must
// all be selectable (issue #15 R3). We assert the chat column keeps rendering
// and — crucially for R7 — that the model selector keeps its full sidebar width
// no matter which engine is active.
const ENGINES = [
  'formal-ai',
  'chatscope',
  'deep-chat',
  'react-chat-elements',
  'assistant-ui',
  'reachat',
];

test.describe('Chat UX shell (issue #15)', () => {
  test('keeps the chat surface reachable beside the model catalog', async ({
    page,
  }) => {
    await page.goto(SHELL_URL);

    // The regression at the heart of issue #15: selecting a model used to push
    // the chat off-screen. The sidebar (with the model catalog) and the chat
    // composer must now be visible at the same time.
    await expect(page.getByTestId('sidebar')).toBeVisible();
    await expect(page.getByTestId('model-selector')).toBeVisible();
    await expect(page.getByTestId('own-chat')).toBeVisible();
    await expect(page.getByTestId('composer-input')).toBeVisible();

    // The seeded greeting is shown in the default (formal-ai) provider.
    await expect(
      page.getByText(/Hello! I'm a small language model running entirely in your browser/)
    ).toBeVisible();
  });

  test('all chat engines are selectable and never narrow the model selector (R3, R7)', async ({
    page,
  }) => {
    await page.goto(SHELL_URL);

    const selector = page.getByTestId('model-selector');
    const dropdown = page.locator('.provider-select');

    for (const engine of ENGINES) {
      await dropdown.selectOption(engine);

      // The chat column keeps rendering for every engine (the container that
      // holds the active provider is always present).
      await expect(page.locator('.chat-main')).toBeVisible();

      // R7: switching engines (notably reachat) must not shrink the sidebar
      // model selector. It lives in its own column now, so its width stays at
      // the full sidebar width regardless of the active engine.
      const box = await selector.boundingBox();
      expect(box, `model selector box for ${engine}`).not.toBeNull();
      expect(box!.width, `model selector width for ${engine}`).toBeGreaterThan(
        250
      );
    }
  });

  test('creates, switches, and deletes conversations', async ({ page }) => {
    await page.goto(SHELL_URL);

    const list = page.getByTestId('conversation-list');
    await expect(list.locator('li')).toHaveCount(1);

    // New chat adds a conversation and makes it active.
    await page.getByTestId('new-conversation').click();
    await expect(list.locator('li')).toHaveCount(2);

    // Delete one — the count drops back.
    await list.locator('li').first().getByLabel('Delete conversation').click();
    await expect(list.locator('li')).toHaveCount(1);
  });

  test('persists conversations across reloads (Links Notation storage, R4/R5)', async ({
    page,
  }) => {
    await page.goto(SHELL_URL);

    await page.getByTestId('new-conversation').click();
    await page.getByTestId('new-conversation').click();
    await expect(page.getByTestId('conversation-list').locator('li')).toHaveCount(
      3
    );

    // The bundle is stored in localStorage as a .lino document.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem('mib_conversations_lino')
    );
    expect(stored).toContain('model_in_browser_bundle');
    expect(stored).toContain('conversation');

    // After a reload the conversations are restored from storage.
    await page.reload();
    await expect(page.getByTestId('conversation-list').locator('li')).toHaveCount(
      3
    );
  });

  test('exports conversations as a .lino bundle (R4)', async ({ page }) => {
    await page.goto(SHELL_URL);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-button').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.lino$/);

    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('model_in_browser_bundle');
    expect(text).toContain('conversation');
  });

  test('imports conversations from a .lino bundle (R4)', async ({ page }) => {
    await page.goto(SHELL_URL);

    // A hand-authored bundle with two conversations, one of which carries a
    // recognizable title derived from its first user message.
    const bundle = [
      'model_in_browser_bundle',
      '  version "1"',
      '  exported_at "2026-06-10T00:00:00.000Z"',
      '  conversation "conv_imported_1"',
      '    title "Imported greeting"',
      '    createdAt "2026-06-10T00:00:00.000Z"',
      '    updatedAt "2026-06-10T00:00:00.000Z"',
      '    message "m1"',
      '      role "user"',
      '      content "Imported greeting"',
      '      sentAt "2026-06-10T00:00:00.000Z"',
      '    message "m2"',
      '      role "assistant"',
      '      content "Hi there from the import"',
      '      sentAt "2026-06-10T00:00:01.000Z"',
      '  conversation "conv_imported_2"',
      '    title "Second thread"',
      '    createdAt "2026-06-10T00:00:00.000Z"',
      '    updatedAt "2026-06-10T00:00:00.000Z"',
      '    message "m3"',
      '      role "user"',
      '      content "Second thread"',
      '      sentAt "2026-06-10T00:00:00.000Z"',
      '',
    ].join('\n');

    const dir = mkdtempSync(join(tmpdir(), 'mib-import-'));
    const file = join(dir, 'chats.lino');
    writeFileSync(file, bundle, 'utf8');

    await page.getByTestId('import-input').setInputFiles(file);

    const list = page.getByTestId('conversation-list');
    await expect(list.locator('li')).toHaveCount(2);
    await expect(page.getByText('Imported greeting').first()).toBeVisible();
    // The imported active conversation's assistant message is rendered.
    await expect(page.getByText('Hi there from the import')).toBeVisible();
  });
});
