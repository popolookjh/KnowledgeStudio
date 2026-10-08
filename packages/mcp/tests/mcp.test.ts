import http from 'node:http';
import { describe, expect, it, afterEach } from 'vitest';
import { ReadOnlyMcpServer, type McpDataSource } from '../src/index.js';

const source: McpDataSource = {
  searchNotes: (query) => Promise.resolve([{ path: 'a.md', content: query }]),
  readNote: (path) => Promise.resolve({ path, content: 'content' }),
  listNotes: () => Promise.resolve([{ path: 'a.md', content: 'a' }]),
  getMetadata: () => Promise.resolve({ type: 'note' }),
  getBacklinks: () => Promise.resolve(['b.md']),
  getOutgoingLinks: () => Promise.resolve(['c.md']),
  searchTags: () => Promise.resolve(['a.md']),
  retrieve: (query, limit) => Promise.resolve([{ path: 'a.md', title: 'A', documentId: null, sourceId: null, score: limit, passage: query, locator: { chunkId: 'a.md#c0' }, citation: 'A' }]),
  resolveCitation: (sourceId) => Promise.resolve({ sourceId }),
  listChanges: (cursor) => Promise.resolve({ cursor: cursor ?? 'v1:x:0', changes: [], hasMore: false }),
  listAnnotations: () => Promise.resolve({ annotations: [] }),
  queryBase: () => Promise.resolve({ rows: [] }),
};
const JSON_HEADERS = { 'content-type': 'application/json' };

let server: ReadOnlyMcpServer | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });

describe('ReadOnlyMcpServer', () => {
  it('advertises exactly the read-only tool set', () => {
    server = new ReadOnlyMcpServer(source);
    expect(server.tools.every((tool) => tool.readOnly)).toBe(true);
    expect(server.tools.map((tool) => tool.name)).toEqual(['search_notes', 'read_note', 'list_notes', 'get_metadata', 'get_backlinks', 'get_outgoing_links', 'search_tags', 'retrieve', 'resolve_citation', 'list_changes', 'list_annotations', 'query_base']);
    expect(server.tools.every((tool) => tool.inputSchema['type'] === 'object')).toBe(true);
  });
  it('binds loopback only and serves tools/list and tools/call', async () => {
    server = new ReadOnlyMcpServer(source, { host: '127.0.0.1', port: 0 });
    const address = await server.start(); expect(address.host).toBe('127.0.0.1'); expect(server.listening).toBe(true);
    const list = await fetch(`${server.endpoint}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ method: 'tools/list' }) }); const listBody = await list.json() as { tools: unknown[] }; expect(listBody.tools).toHaveLength(12);
    const call = await fetch(`${server.endpoint}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ method: 'tools/call', params: { name: 'read_note', arguments: { path: 'a.md' } } }) }); const callBody = await call.json() as { content: { path: string } }; expect(callBody.content.path).toBe('a.md');
  });
  it('rejects disallowed write/delete/shell tools', async () => {
    server = new ReadOnlyMcpServer(source, { port: 0 }); await server.start();
    const response = await fetch(`${server.endpoint}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ method: 'tools/call', params: { name: 'delete', arguments: { path: 'a.md' } } }) }); const body = await response.json() as { error: string }; expect(response.status).toBe(400); expect(body.error).toMatch(/disallowed/);
  });
  it('rejects non-POST requests and oversized requests', async () => {
    server = new ReadOnlyMcpServer(source, { port: 0 }); await server.start();
    const get = await fetch(`${server.endpoint}`); expect(get.status).toBe(405);
  });
  it('rejects non-loopback runtime options', async () => {
    server = new ReadOnlyMcpServer(source, { host: '0.0.0.0' as never, port: 0 });
    await expect(server.start()).rejects.toThrow(/loopback/);
  });
  it('stops cleanly and prevents duplicate start', async () => {
    server = new ReadOnlyMcpServer(source, { port: 0 }); await server.start(); await expect(server.start()).rejects.toThrow(/already/); await server.stop(); expect(server.listening).toBe(false);
  });
  it('rejects browser Origin, foreign Host (DNS rebinding), and non-JSON content types', async () => {
    server = new ReadOnlyMcpServer(source, { port: 0 }); const { port } = await server.start();
    const body = JSON.stringify({ method: 'tools/list' });
    expect((await fetch(`${server.endpoint}`, { method: 'POST', headers: { ...JSON_HEADERS, origin: 'https://evil.example' }, body })).status).toBe(403);
    expect((await fetch(`${server.endpoint}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body })).status).toBe(415);
    const rebinding = await new Promise<number>((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, method: 'POST', headers: { host: `evil.example:${port}`, 'content-type': 'application/json' } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
      request.on('error', reject); request.end(body);
    });
    expect(rebinding).toBe(403);
  });
  it('speaks JSON-RPC 2.0 MCP: initialize, tools/list, content blocks, and error objects', async () => {
    server = new ReadOnlyMcpServer(source, { port: 0, version: '9.9.9' }); await server.start();
    const endpoint = `${server.endpoint}`;
    const post = async (payload: unknown): Promise<Record<string, unknown>> => (await (await fetch(endpoint, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(payload) })).json()) as Record<string, unknown>;
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(init).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'knowledge-studio', version: '9.9.9' } } });
    const notified = await fetch(endpoint, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    expect(notified.status).toBe(202);
    const call = await post({ jsonrpc: '2.0', id: 'r', method: 'tools/call', params: { name: 'retrieve', arguments: { query: 'پژوهش', limit: 3 } } });
    const result = call['result'] as { content: { type: string; text: string }[]; structuredContent: { result: { score: number }[] } };
    expect(result.content[0]!.type).toBe('text');
    expect(result.structuredContent.result[0]!.score).toBe(3);
    const invalid = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'retrieve', arguments: { query: 'x', limit: 999 } } });
    expect(invalid['error']).toMatchObject({ code: -32602 });
    const unknown = await post({ jsonrpc: '2.0', id: 3, method: 'resources/write' });
    expect(unknown['error']).toMatchObject({ code: -32601 });
  });
});
