import path from 'node:path';
import process from 'node:process';
import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture, waitForCanvasZoom } from './fixture';

let fixture!: E2eFixture;
let launched = false;
test.skip(!process.env['ELECTRON_E2E_EXECUTABLE'], 'Packaged suite requires ELECTRON_E2E_EXECUTABLE');

test.beforeEach(async () => { fixture = await launchFixture('packaged'); launched = true; });
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('@packaged launches the actual executable with preload-only renderer authority', async () => {
  expect(fixture.launchMode).toBe('packaged');
  expect(path.basename(process.env['ELECTRON_E2E_EXECUTABLE'] ?? '').toLowerCase()).toBe('knowledgestudio.exe');
  await expect(fixture.page.locator('.workbench')).toBeVisible();
  await expect(fixture.page.getByText('Knowledge Studio', { exact: true }).first()).toBeVisible();
  expect(await fixture.page.evaluate(() => ({
    bridge: Boolean((window as unknown as { knowledgeStudio?: unknown }).knowledgeStudio),
    protocol: location.protocol,
    nodeProcess: typeof (globalThis as Record<string, unknown>)['process'],
    nodeRequire: typeof (globalThis as Record<string, unknown>)['require'],
  }))).toEqual({ bridge: true, protocol: 'file:', nodeProcess: 'undefined', nodeRequire: 'undefined' });
  await expect(fixture.page.getByRole('tab', { name: 'Smoke' })).toBeVisible();
});

test('@packaged exercises local-first critical workflows without source launch arguments', async () => {
  const { page } = fixture;
  await page.getByRole('treeitem', { name: /Smoke\.md/ }).click();
  const editor = page.locator('.cm-content').last();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# Packaged note\n\nPersisted text\n');
  await page.keyboard.press('Control+S');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Smoke' }).click();
  await expect(page.locator('.cm-content').last()).toContainText('Persisted text');

  await page.keyboard.press('Control+P');
  const search = page.getByPlaceholder('Search the vault…');
  await search.fill('فارسی');
  await expect(page.locator('.search-overlay__hit')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Second' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Smoke\.md/ }).click();
  await page.getByRole('button', { name: /9\/4\/2026/ }).click();
  await expect(page.locator('.history-panel__diff')).toContainText('Original revision content.');

  const git = page.locator('.git-panel');
  await git.locator('input[aria-label="Select Smoke.md"]').check();
  await git.getByRole('button', { name: 'View selected diff' }).click();
  await expect(git.locator('.git-panel__diff')).toContainText('Persisted text');
  await expect(git.getByRole('button', { name: 'Commit selected' })).toBeDisabled();

  const plugin = page.locator('.plugin-panel');
  await plugin.getByLabel('Enable policy').click();
  await expect(plugin.getByText(/High-risk permissions require approval/)).toBeVisible();
  await plugin.getByLabel('Explicitly approve SECRETS').click();
  await expect(plugin.getByText(/enabled by policy/)).toBeVisible();

  const mcp = page.locator('.mcp-panel');
  await mcp.getByRole('button', { name: 'Start local MCP' }).click();
  await expect(mcp.getByText(/Bind: http:\/\/127\.0\.0\.1:/)).toBeVisible();
  await mcp.getByRole('button', { name: 'Stop MCP' }).click();
  await expect(mcp.getByText('Status: stopped')).toBeVisible();

  const ai = page.locator('.ai-panel');
  await expect(ai.getByText('Provider-neutral and offline by default. Opening this panel never contacts a provider.')).toBeVisible();
  await expect(ai.getByText(/local · no model · disabled/)).toBeVisible();

  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.locator('.graph-overlay__canvas')).toBeVisible();
  await page.locator('.graph-overlay').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Canvas' }).click();
  await page.getByRole('button', { name: '+ Text' }).click();
  await page.locator('.canvas__board').hover({ position: { x: 360, y: 260 } });
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => waitForCanvasZoom(fixture.vault)).toBeGreaterThan(1);
  await expect(page.locator('.canvas-node')).toHaveCount(1);
  await expect(page.locator('.canvas__status')).toContainText('Saved');
});
