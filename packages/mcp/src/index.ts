import http from 'node:http';

/**
 * Read-only local MCP-style server. The transport is JSON-RPC over HTTP;
 * the tool contract intentionally excludes delete, shell, process, arbitrary
 * filesystem access, and write operations. It binds loopback only.
 */

export interface NoteRecord { readonly path: string; readonly content: string; readonly documentId?: string | null; readonly sourceId?: string | null; readonly metadata?: Record<string, unknown>; }
export interface McpDataSource {
  searchNotes(query: string): Promise<readonly NoteRecord[]>;
  readNote(path: string): Promise<NoteRecord | null>;
  listNotes(): Promise<readonly NoteRecord[]>;
  getMetadata(path: string): Promise<Record<string, unknown> | null>;
  getBacklinks(path: string): Promise<readonly string[]>;
  getOutgoingLinks(path: string): Promise<readonly string[]>;
  searchTags(tag: string): Promise<readonly string[]>;
}

export interface McpToolDefinition { readonly name: string; readonly description: string; readonly readOnly: true; }
export interface McpServerOptions { readonly host?: '127.0.0.1' | '::1'; readonly port?: number; }

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  { name: 'search_notes', description: 'Search note titles and content.', readOnly: true },
  { name: 'read_note', description: 'Read a note by vault-relative path.', readOnly: true },
  { name: 'list_notes', description: 'List notes in the vault.', readOnly: true },
  { name: 'get_metadata', description: 'Get typed frontmatter metadata for a note.', readOnly: true },
  { name: 'get_backlinks', description: 'Get notes linking to a note.', readOnly: true },
  { name: 'get_outgoing_links', description: 'Get links leaving a note.', readOnly: true },
  { name: 'search_tags', description: 'Find notes carrying a tag.', readOnly: true },
];

export class ReadOnlyMcpServer {
  private server: http.Server | null = null;
  private address: { host: string; port: number } | null = null;
  constructor(private readonly source: McpDataSource, private readonly options: McpServerOptions = {}) {}

  get tools(): readonly McpToolDefinition[] { return MCP_TOOLS; }
  get listening(): boolean { return this.server !== null; }
  get endpoint(): string | null { return this.address ? `http://${this.address.host}:${this.address.port}` : null; }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) throw new Error('MCP server is already running');
    const host = this.options.host ?? '127.0.0.1';
    if (host !== '127.0.0.1' && host !== '::1') {
      throw new Error('MCP server may bind only to loopback addresses');
    }
    const port = this.options.port ?? 0;
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('MCP server did not expose an address');
    this.address = { host, port: address.port };
    return this.address;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'POST') { response.statusCode = 405; response.end(JSON.stringify({ error: 'POST required' })); return; }
    let body = ''; request.setEncoding('utf8');
    for await (const chunk of request) { body += chunk; if (body.length > 1_000_000) { response.statusCode = 413; response.end(JSON.stringify({ error: 'request too large' })); return; } }
    try {
      const parsed: unknown = JSON.parse(body);
      const result = await this.dispatch(parsed);
      response.statusCode = 200; response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 400; response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  }

  private async dispatch(request: unknown): Promise<unknown> {
    if (typeof request !== 'object' || request === null) throw new Error('Invalid JSON-RPC request');
    const record = request as Record<string, unknown>;
    const method = record['method']; const params = record['params'];
    if (method === 'tools/list') return { tools: this.tools };
    if (method !== 'tools/call' || typeof params !== 'object' || params === null) throw new Error('Unsupported MCP method');
    const call = params as Record<string, unknown>; const name = call['name']; const argumentsValue = call['arguments'];
    if (typeof name !== 'string' || !MCP_TOOLS.some((tool) => tool.name === name)) throw new Error(`Unknown or disallowed tool: ${String(name)}`);
    const args = argumentsValue && typeof argumentsValue === 'object' ? argumentsValue as Record<string, unknown> : {};
    const stringArg = (key: string): string => { const value = args[key]; if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} is required`); return value; };
    switch (name) {
      case 'search_notes': return { content: await this.source.searchNotes(stringArg('query')) };
      case 'read_note': return { content: await this.source.readNote(stringArg('path')) };
      case 'list_notes': return { content: await this.source.listNotes() };
      case 'get_metadata': return { content: await this.source.getMetadata(stringArg('path')) };
      case 'get_backlinks': return { content: await this.source.getBacklinks(stringArg('path')) };
      case 'get_outgoing_links': return { content: await this.source.getOutgoingLinks(stringArg('path')) };
      case 'search_tags': return { content: await this.source.searchTags(stringArg('tag')) };
      default: throw new Error('Tool not implemented');
    }
  }
}
