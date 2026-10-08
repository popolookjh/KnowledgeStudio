import path from 'node:path';
import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture, waitForFile } from './fixture';

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => { fixture = await launchFixture('integration'); launched = true; });
test.afterEach(async () => { if (launched) { assertNoRuntimeErrors(fixture); await closeFixture(fixture); } launched = false; });

test('integrity repair gives external notes stable IDs that MCP citations then resolve', async () => {
  const { page, vault } = fixture;
  const integrity = page.locator('.integrity-panel');
  await integrity.getByRole('button', { name: 'Check identity & provenance' }).click();
  await expect(integrity.locator('div', { hasText: 'Missing IDs' }).locator('dd')).toHaveText('2');
  await integrity.getByRole('button', { name: 'Assign missing IDs' }).click();
  await expect(integrity.getByRole('status')).toHaveText('Assigned 2 IDs, renewed 0 duplicate IDs');
  await expect(integrity.locator('div', { hasText: 'Notes with stable ID' }).locator('dd')).toHaveText('2 / 2');
  await expect(integrity.getByText(/2 events · v1:/)).toBeVisible();
  const smoke = await waitForFile(path.join(vault, 'Smoke.md'), (content) => /^---\nid: [0-9a-f-]{36}\n---\n/.test(content));
  expect(smoke).toContain('Current changed content.');
  // The open editor tab reloads the repaired file rather than conflicting.
  await expect(page.locator('.cm-content')).toContainText('id: ');
  await expect(page.locator('.conflict')).toHaveCount(0);

  const mcp = page.locator('.mcp-panel');
  await mcp.getByRole('button', { name: 'Start local MCP' }).click();
  const bind = mcp.getByText(/Bind: http:\/\/127\.0\.0\.1:\d+/);
  await expect(bind).toBeVisible();
  const endpoint = /http:\/\/127\.0\.0\.1:\d+/.exec(await bind.innerText())![0];
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'retrieve', arguments: { query: 'changed content' } } }) });
  const body = await response.json() as { result: { structuredContent: { result: { path: string; sourceId: string | null }[] } } };
  expect(body.result.structuredContent.result[0]).toMatchObject({ path: 'Smoke.md', sourceId: expect.stringMatching(/^ks:/) });
  await mcp.getByRole('button', { name: 'Stop MCP' }).click();
});
