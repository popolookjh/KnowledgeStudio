import { expect, test } from '@playwright/test';
import { assertNoRuntimeErrors, closeFixture, launchFixture, type E2eFixture } from './fixture';

let fixture!: E2eFixture;
let launched = false;

test.beforeEach(async () => {
  fixture = await launchFixture('mcp-v2', {
    'Research/Trees.md':
      '---\nid: 0b7f3c1e-8d2a-4f6b-9c1d-2e3f4a5b6c7d\ntitle: Tree study\n---\n# Results\nMean trunk diameter was 42 cm.\n',
  });
  launched = true;
});
test.afterEach(async () => {
  if (launched) {
    assertNoRuntimeErrors(fixture);
    await closeFixture(fixture);
  }
  launched = false;
});

test('running app serves MCP Retrieval V2 with citations over loopback only', async () => {
  const { page } = fixture;
  const mcp = page.locator('.mcp-panel');
  await mcp.getByRole('button', { name: 'Start local MCP' }).click();
  const bind = mcp.getByText(/Bind: http:\/\/127\.0\.0\.1:\d+/);
  await expect(bind).toBeVisible();
  const endpoint = /http:\/\/127\.0\.0\.1:\d+/.exec(await bind.innerText())![0];
  await expect(mcp.getByText(/Vault ID: /)).toBeVisible();
  await expect(
    mcp.getByText(/retrieve, resolve_citation, list_changes, list_annotations, query_base/),
  ).toBeVisible();

  const rpc = async (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const retrieved = (await (
    await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'retrieve', arguments: { query: 'trunk diameter', limit: 3 } },
    })
  ).json()) as {
    result: {
      structuredContent: { result: { path: string; sourceId: string | null; citation: string }[] };
    };
  };
  const hit = retrieved.result.structuredContent.result[0]!;
  expect(hit).toMatchObject({ path: 'Research/Trees.md', citation: 'Tree study § Results' });
  expect(hit.sourceId).toMatch(/^ks:/);
  const resolved = (await (
    await rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'resolve_citation', arguments: { sourceId: hit.sourceId } },
    })
  ).json()) as { result: { structuredContent: { result: { resolution: { state: string } } } } };
  expect(resolved.result.structuredContent.result.resolution.state).toBe('resolved');
  expect((await rpc({ method: 'tools/list' }, { origin: 'https://evil.example' })).status).toBe(
    403,
  );

  await mcp.getByRole('button', { name: 'Stop MCP' }).click();
  await expect(mcp.getByText('Status: stopped')).toBeVisible();
  await expect(fetch(endpoint, { method: 'POST' })).rejects.toThrow();
});
