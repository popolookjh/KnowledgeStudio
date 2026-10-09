import http from 'node:http';

export { chunkMarkdown, scoreChunks, tokenize, type Chunk, type ScoredChunk } from './retrieval.js';

/**
 * Read-only local MCP-style server (Retrieval V2). The transport is
 * JSON-RPC over HTTP; the tool contract intentionally excludes delete,
 * shell, process, arbitrary filesystem access, and write operations. It
 * binds loopback only and rejects browser-originated (Origin), non-JSON,
 * and DNS-rebinding (foreign Host) requests.
 */

export interface NoteRecord {
  readonly path: string;
  readonly content: string;
  readonly documentId?: string | null;
  readonly sourceId?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface RetrievalHit {
  readonly path: string;
  readonly title: string;
  readonly documentId: string | null;
  readonly sourceId: string | null;
  readonly score: number;
  readonly passage: string;
  readonly locator: { readonly heading?: string; readonly chunkId: string };
  readonly citation: string;
}

export interface McpDataSource {
  searchNotes(query: string): Promise<readonly NoteRecord[]>;
  readNote(path: string): Promise<NoteRecord | null>;
  listNotes(): Promise<readonly NoteRecord[]>;
  getMetadata(path: string): Promise<Record<string, unknown> | null>;
  getBacklinks(path: string): Promise<readonly string[]>;
  getOutgoingLinks(path: string): Promise<readonly string[]>;
  searchTags(tag: string): Promise<readonly string[]>;
  /** V2: ranked, cited passages. */
  retrieve(query: string, limit: number): Promise<readonly RetrievalHit[]>;
  /** V2: resolves a stable sourceId to its provenance and current location. */
  resolveCitation(sourceId: string): Promise<unknown>;
  /** V2: incremental sync over the durable change feed. */
  listChanges(cursor: string | undefined, limit: number): Promise<unknown>;
  /** V2: PDF annotations with page citations. */
  listAnnotations(pdfPath: string): Promise<unknown>;
  /** V2: runs a saved Base and returns metadata rows (never note bodies). */
  queryBase(baseId: string): Promise<unknown>;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly readOnly: true;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}
export interface McpServerOptions {
  readonly host?: '127.0.0.1' | '::1';
  readonly port?: number;
  readonly version?: string;
}

const stringProp = (description: string): Record<string, unknown> => ({
  type: 'string',
  description,
});
const schema = (
  properties: Record<string, unknown>,
  required: readonly string[],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'search_notes',
    description: 'Search note titles and content.',
    readOnly: true,
    inputSchema: schema({ query: stringProp('Search text') }, ['query']),
  },
  {
    name: 'read_note',
    description: 'Read a note by vault-relative path.',
    readOnly: true,
    inputSchema: schema({ path: stringProp('Vault-relative note path') }, ['path']),
  },
  {
    name: 'list_notes',
    description: 'List notes in the vault.',
    readOnly: true,
    inputSchema: schema({}, []),
  },
  {
    name: 'get_metadata',
    description: 'Get typed frontmatter metadata for a note.',
    readOnly: true,
    inputSchema: schema({ path: stringProp('Vault-relative note path') }, ['path']),
  },
  {
    name: 'get_backlinks',
    description: 'Get notes linking to a note.',
    readOnly: true,
    inputSchema: schema({ path: stringProp('Vault-relative note path') }, ['path']),
  },
  {
    name: 'get_outgoing_links',
    description: 'Get links leaving a note.',
    readOnly: true,
    inputSchema: schema({ path: stringProp('Vault-relative note path') }, ['path']),
  },
  {
    name: 'search_tags',
    description: 'Find notes carrying a tag.',
    readOnly: true,
    inputSchema: schema({ tag: stringProp('Tag without #') }, ['tag']),
  },
  {
    name: 'retrieve',
    description:
      'Ranked passages with stable machine citations (sourceId, documentId, heading, chunkId).',
    readOnly: true,
    inputSchema: schema(
      {
        query: stringProp('Natural-language or keyword query'),
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      ['query'],
    ),
  },
  {
    name: 'resolve_citation',
    description: 'Resolve a sourceId to its provenance record and current vault location.',
    readOnly: true,
    inputSchema: schema({ sourceId: stringProp('Stable ks: source identifier') }, ['sourceId']),
  },
  {
    name: 'list_changes',
    description: 'Durable change feed since a cursor for incremental sync.',
    readOnly: true,
    inputSchema: schema(
      {
        cursor: stringProp('Cursor from a previous call; omit to start'),
        limit: { type: 'integer', minimum: 1, maximum: 500 },
      },
      [],
    ),
  },
  {
    name: 'list_annotations',
    description: 'PDF highlights and notes with page citations.',
    readOnly: true,
    inputSchema: schema({ path: stringProp('Vault-relative PDF path') }, ['path']),
  },
  {
    name: 'query_base',
    description: 'Run a saved Base (metadata rows only, no note bodies).',
    readOnly: true,
    inputSchema: schema({ baseId: stringProp('Base identifier') }, ['baseId']),
  },
];

class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export class ReadOnlyMcpServer {
  private server: http.Server | null = null;
  private address: { host: string; port: number } | null = null;
  constructor(
    private readonly source: McpDataSource,
    private readonly options: McpServerOptions = {},
  ) {}

  get tools(): readonly McpToolDefinition[] {
    return MCP_TOOLS;
  }
  get listening(): boolean {
    return this.server !== null;
  }
  get endpoint(): string | null {
    return this.address
      ? `http://${this.address.host === '::1' ? '[::1]' : this.address.host}:${this.address.port}`
      : null;
  }

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
    if (!address || typeof address === 'string')
      throw new Error('MCP server did not expose an address');
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

  /** Accepts only loopback Host headers for the bound port (DNS-rebinding guard). */
  private hostAllowed(hostHeader: string | undefined): boolean {
    if (!hostHeader || !this.address) return false;
    const port = String(this.address.port);
    return ['127.0.0.1', 'localhost', '[::1]'].some(
      (name) => hostHeader.toLowerCase() === `${name}:${port}`,
    );
  }

  private async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    const reject = (status: number, error: string): void => {
      response.statusCode = status;
      response.end(JSON.stringify({ error }));
    };
    if (request.method !== 'POST') {
      reject(405, 'POST required');
      return;
    }
    if (!this.hostAllowed(request.headers.host)) {
      reject(403, 'Host header must be the loopback endpoint');
      return;
    }
    if (request.headers.origin !== undefined) {
      reject(403, 'Browser-originated requests are not allowed');
      return;
    }
    if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) {
      reject(415, 'Content-Type must be application/json');
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(413, 'request too large');
        return;
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      reject(400, 'Invalid JSON');
      return;
    }
    const envelope =
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as Record<string, unknown>)['jsonrpc'] === '2.0';
    const id = envelope ? ((parsed as Record<string, unknown>)['id'] ?? null) : null;
    try {
      const result = await this.dispatch(parsed, envelope);
      if (result === undefined) {
        response.statusCode = 202;
        response.end();
        return;
      }
      response.statusCode = 200;
      response.end(JSON.stringify(envelope ? { jsonrpc: '2.0', id, result } : result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (envelope) {
        response.statusCode = 200;
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: error instanceof RpcFailure ? error.code : -32603, message },
          }),
        );
        return;
      }
      reject(400, message);
    }
  }

  private async dispatch(request: unknown, envelope: boolean): Promise<unknown> {
    if (typeof request !== 'object' || request === null)
      throw new RpcFailure(-32600, 'Invalid JSON-RPC request');
    const record = request as Record<string, unknown>;
    const method = record['method'];
    const params = record['params'];
    if (method === 'initialize')
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: { name: 'knowledge-studio', version: this.options.version ?? '0.0.0' },
        capabilities: { tools: { listChanged: false } },
        instructions: 'Read-only local vault access. Cite results with their sourceId.',
      };
    if (method === 'notifications/initialized') return undefined;
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: this.tools };
    if (method !== 'tools/call' || typeof params !== 'object' || params === null)
      throw new RpcFailure(-32601, 'Unsupported MCP method');
    const call = params as Record<string, unknown>;
    const name = call['name'];
    const argumentsValue = call['arguments'];
    if (typeof name !== 'string' || !MCP_TOOLS.some((tool) => tool.name === name))
      throw new RpcFailure(-32602, `Unknown or disallowed tool: ${String(name)}`);
    const args =
      argumentsValue && typeof argumentsValue === 'object'
        ? (argumentsValue as Record<string, unknown>)
        : {};
    const payload = await this.callTool(name, args);
    // MCP clients (JSON-RPC 2.0) get standard content blocks; legacy callers keep `{ content: payload }`.
    return envelope
      ? {
          content: [{ type: 'text', text: JSON.stringify(payload) }],
          structuredContent: { result: payload },
          isError: false,
        }
      : { content: payload };
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const stringArg = (key: string, max = 1024): string => {
      const value = args[key];
      if (typeof value !== 'string' || value.length === 0 || value.length > max)
        throw new RpcFailure(-32602, `${key} is required`);
      return value;
    };
    const limitArg = (fallback: number, max: number): number => {
      const value = args['limit'];
      if (value === undefined) return fallback;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
        throw new RpcFailure(-32602, `limit must be 1-${max}`);
      return value;
    };
    switch (name) {
      case 'search_notes':
        return this.source.searchNotes(stringArg('query', 500));
      case 'read_note':
        return this.source.readNote(stringArg('path'));
      case 'list_notes':
        return this.source.listNotes();
      case 'get_metadata':
        return this.source.getMetadata(stringArg('path'));
      case 'get_backlinks':
        return this.source.getBacklinks(stringArg('path'));
      case 'get_outgoing_links':
        return this.source.getOutgoingLinks(stringArg('path'));
      case 'search_tags':
        return this.source.searchTags(stringArg('tag', 128));
      case 'retrieve':
        return this.source.retrieve(stringArg('query', 500), limitArg(10, 50));
      case 'resolve_citation':
        return this.source.resolveCitation(stringArg('sourceId', 256));
      case 'list_changes': {
        const cursor = args['cursor'];
        if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 256))
          throw new RpcFailure(-32602, 'cursor is invalid');
        return this.source.listChanges(cursor, limitArg(100, 500));
      }
      case 'list_annotations':
        return this.source.listAnnotations(stringArg('path'));
      case 'query_base':
        return this.source.queryBase(stringArg('baseId', 64));
      default:
        throw new RpcFailure(-32601, 'Tool not implemented');
    }
  }
}
