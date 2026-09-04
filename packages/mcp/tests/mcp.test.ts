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
};

let server: ReadOnlyMcpServer | undefined;
afterEach(async () => { await server?.stop(); server = undefined; });

describe('ReadOnlyMcpServer', () => {
  it('advertises exactly the read-only tool set', () => {
    server = new ReadOnlyMcpServer(source);
    expect(server.tools.every((tool) => tool.readOnly)).toBe(true);
    expect(server.tools.map((tool) => tool.name)).toEqual(['search_notes', 'read_note', 'list_notes', 'get_metadata', 'get_backlinks', 'get_outgoing_links', 'search_tags']);
  });
  it('binds loopback only and serves tools/list and tools/call', async () => {
    server = new ReadOnlyMcpServer(source, { host: '127.0.0.1', port: 0 });
    const address = await server.start(); expect(address.host).toBe('127.0.0.1'); expect(server.listening).toBe(true);
    const list = await fetch(`${server.endpoint}`, { method: 'POST', body: JSON.stringify({ method: 'tools/list' }) }); const listBody = await list.json() as { tools: unknown[] }; expect(listBody.tools).toHaveLength(7);
    const call = await fetch(`${server.endpoint}`, { method: 'POST', body: JSON.stringify({ method: 'tools/call', params: { name: 'read_note', arguments: { path: 'a.md' } } }) }); const callBody = await call.json() as { content: { path: string } }; expect(callBody.content.path).toBe('a.md');
  });
  it('rejects disallowed write/delete/shell tools', async () => {
    server = new ReadOnlyMcpServer(source, { port: 0 }); await server.start();
    const response = await fetch(`${server.endpoint}`, { method: 'POST', body: JSON.stringify({ method: 'tools/call', params: { name: 'delete', arguments: { path: 'a.md' } } }) }); const body = await response.json() as { error: string }; expect(response.status).toBe(400); expect(body.error).toMatch(/disallowed/);
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
});
