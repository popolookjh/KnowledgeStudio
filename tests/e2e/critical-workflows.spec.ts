import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, restartFixture, type E2eFixture, waitForCanvasZoom, waitForWorkspaceTab } from './fixture';

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => { fixture = await launchFixture('workflows'); launched = true; });
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('vault, note, search, workspace, wiki links and tags workflows', async () => {
  const { page } = fixture;
  await expect(page.getByRole('treeitem', { name: /Smoke\.md/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /Second\.md/ })).toBeVisible();

  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('tab', { name: /untitled/ })).toBeVisible();
  const editor = page.locator('.cm-content').last();
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('# E2E note\n\nPersisted text\n');
  await page.keyboard.press('Control+S');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /untitled/ }).locator('.tabs__close').click();
  await page.getByRole('treeitem', { name: /untitled/ }).click();
  await expect(page.locator('.cm-content').last()).toContainText('Persisted text');

  await page.keyboard.press('Control+P');
  const searchInput = page.getByPlaceholder('Search the vault…');
  await expect(searchInput).toBeVisible();
  await searchInput.fill('فارسی');
  await expect(page.locator('.search-overlay__hit')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Second' })).toBeVisible();
  await page.getByRole('treeitem', { name: /Smoke\.md/ }).click();
  await expect(page.getByText('Backlinks (1)', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: /Second\.md/ }).click();
  await page.getByRole('button', { name: /#persian/ }).click();
  await expect(page.getByText('Second', { exact: true }).last()).toBeVisible();

  expect(await waitForWorkspaceTab(fixture.userData, 'Second.md')).toBe(true);
  fixture = await restartFixture(fixture);
  await expect(fixture.page.getByRole('tab', { name: 'Second' })).toBeVisible();
});

test('history revision diff and explicit restore confirmation', async () => {
  const { page } = fixture;
  await page.getByRole('button', { name: /9\/4\/2026/ }).click();
  await expect(page.getByText('Diff against current buffer')).toBeVisible();
  await expect(page.locator('.history-panel__diff')).toContainText('Original revision content.');
  await page.getByRole('button', { name: 'Restore…' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Confirm revision restore' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm restore' }).click();
  await expect(page.locator('.cm-content')).toContainText('Original revision content.');
});

test('Git status and selected-file diff without commit', async () => {
  const { page } = fixture;
  await expect(page.getByText(/Branch: master/)).toBeVisible();
  const gitPanel = page.locator('.git-panel');
  await gitPanel.locator('input[aria-label="Select Smoke.md"]').check();
  await gitPanel.getByRole('button', { name: 'View selected diff' }).click();
  await expect(gitPanel.locator('.git-panel__diff')).toContainText('Current changed content.');
  await expect(gitPanel.getByRole('button', { name: 'Commit selected' })).toBeDisabled();
});

test('plugin MCP and AI operational controls preserve safety boundaries', async () => {
  const { page } = fixture;
  const plugin = page.locator('.plugin-panel');
  await expect(plugin.getByText('Local manifests only. Plugin runtime loading is deferred.')).toBeVisible();
  await expect(plugin.getByText('Requested: VAULT_READ, SECRETS')).toBeVisible();
  await expect(plugin.getByText(/High-risk permissions require approval/)).toBeVisible();
  await plugin.getByLabel('Enable policy').click();
  await expect(plugin.getByText(/High-risk permissions require approval/)).toBeVisible();
  const secretApproval = plugin.getByLabel('Explicitly approve SECRETS');
  await secretApproval.click();
  await expect(plugin.getByText(/enabled by policy/)).toBeVisible();
  await plugin.getByRole('button', { name: 'Refresh local manifests' }).click();
  await expect(secretApproval).toBeChecked();

  const mcp = page.locator('.mcp-panel');
  await mcp.getByRole('button', { name: 'Start local MCP' }).click();
  await expect(mcp.getByText(/Bind: http:\/\/127\.0\.0\.1:/)).toBeVisible();
  await expect(mcp.getByText(/no shell, process, or write tools/)).toBeVisible();
  await mcp.getByRole('button', { name: 'Stop MCP' }).click();
  await expect(mcp.getByText('Status: stopped')).toBeVisible();

  const ai = page.locator('.ai-panel');
  const externalRequests: string[] = [];
  page.on('request', (request) => { if (/^https?:/i.test(request.url())) externalRequests.push(request.url()); });
  await expect(ai.getByText('Provider-neutral and offline by default. Opening this panel never contacts a provider.')).toBeVisible();
  await expect(ai.getByText(/local · no model · disabled/)).toBeVisible();
  await ai.locator('summary').click();
  await ai.getByPlaceholder('provider.id').fill('local.fixture');
  await ai.getByPlaceholder('Display name').fill('Local Fixture');
  await ai.getByRole('button', { name: 'Save provider metadata' }).click();
  await expect(ai.getByText('Local Fixture', { exact: true })).toBeVisible();
  await ai.locator('.ai-panel__entry').filter({ hasText: 'Local Fixture' }).getByRole('button', { name: 'Set credential' }).click();
  const credential = ai.locator('input[type="password"]');
  await credential.fill('fixture-secret-never-returned');
  await credential.fill('');
  await expect(credential).toHaveValue('');
  await ai.getByPlaceholder('provider.id').fill('external.fixture');
  await ai.getByPlaceholder('Display name').fill('External Fixture');
  await ai.locator('select').selectOption('external');
  await ai.getByPlaceholder('https://provider.example').fill('https://provider.example');
  await ai.getByLabel('This provider may receive vault content').check();
  await ai.getByRole('button', { name: 'Save provider metadata' }).click();
  await expect(ai.getByText(/requires explicit user confirmation/)).toBeVisible();
  expect(externalRequests).toEqual([]);
  await expect(ai.getByText(/Credential entry is transient/)).toBeVisible();
});

test('lazy Graph and Canvas open, interact, save, and close', async () => {
  const { page } = fixture;
  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.locator('.graph-overlay__canvas')).toBeVisible();
  await page.locator('.graph-overlay').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.workbench')).toBeVisible();

  await page.getByRole('button', { name: 'Canvas' }).click();
  await expect(page.locator('.canvas__board')).toBeVisible();
  await page.getByRole('button', { name: '+ Text' }).click();
  const node = page.locator('.canvas-node').last();
  await expect(node).toBeVisible();
  await node.click();
  const resize = page.locator('.canvas-node__resize');
  await expect(resize).toBeVisible();
  const beforeGeometry = await node.getAttribute('style');
  const resizeBox = await resize.boundingBox();
  if (!resizeBox) throw new Error('Resize handle has no box');
  await page.mouse.move(resizeBox.x + 4, resizeBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 50, resizeBox.y + 35);
  await page.mouse.up();
  await expect(page.locator('.canvas__status')).toContainText('Saved');
  await page.locator('.canvas__board').hover({ position: { x: 360, y: 260 } });
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => waitForCanvasZoom(fixture.vault)).toBeGreaterThan(1);
  const persistedTransform = await page.locator('.canvas__world').getAttribute('style');
  await page.locator('.canvas-overlay__header').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.workbench')).toBeVisible();
  await page.getByRole('button', { name: 'Canvas' }).click();
  await expect(page.locator('.canvas__board')).toBeVisible();
  await expect(page.locator('.canvas-node')).toHaveCount(1);
  expect(await page.locator('.canvas-node').getAttribute('style')).not.toBe(beforeGeometry);
  await expect(page.locator('.canvas__world')).toHaveAttribute('style', persistedTransform ?? '');
});
