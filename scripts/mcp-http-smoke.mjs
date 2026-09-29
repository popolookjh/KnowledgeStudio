import { ReadOnlyMcpServer } from '../packages/mcp/dist/src/index.js';

const server = new ReadOnlyMcpServer({
  searchNotes: async (query) => [{ path: 'smoke.md', content: query }],
  readNote: async (notePath) => ({ path: notePath, content: 'smoke' }),
  listNotes: async () => [{ path: 'smoke.md', content: 'smoke' }],
  getMetadata: async () => ({ source: 'smoke' }),
  getBacklinks: async () => [],
  getOutgoingLinks: async () => [],
  searchTags: async () => [],
  retrieve: async () => [],
  resolveCitation: async () => null,
  listChanges: async () => ({ cursor: 'v1:smoke:0', changes: [], hasMore: false }),
  listAnnotations: async () => ({ annotations: [] }),
  queryBase: async () => ({ rows: [] }),
}, { host: '127.0.0.1', port: 0 });

try {
  const address = await server.start();
  const response = await fetch(`${server.endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'tools/list' }),
  });
  const body = await response.json();
  if (!response.ok || !Array.isArray(body.tools) || body.tools.length !== 12) {
    throw new Error('MCP loopback smoke did not expose twelve read-only tools');
  }
  console.log(`MCP_SMOKE ${address.host} tools=${body.tools.length}`);
} finally {
  await server.stop();
}
