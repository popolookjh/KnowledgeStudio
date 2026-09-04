import { MCP_TOOLS, ReadOnlyMcpServer, type McpDataSource } from '@knowledge-studio/mcp';

/**
 * Desktop-facing MCP lifecycle controller. A vault data source must be
 * explicitly attached before start; changing or closing the vault always
 * stops the listener. This class owns no filesystem or network authority
 * beyond the existing loopback-only read-only server.
 */
export interface McpHostStatus {
  readonly running: boolean;
  readonly endpoint: string | null;
  readonly vaultId: string | null;
  readonly tools: readonly string[];
  readonly lastError: string | null;
}

export class ActiveVaultMcpHost {
  private server: ReadOnlyMcpServer | null = null;
  private source: McpDataSource | null = null;
  private vaultId: string | null = null;
  private lastError: string | null = null;

  get status(): McpHostStatus {
    return {
      running: this.server?.listening ?? false,
      endpoint: this.server?.endpoint ?? null,
      vaultId: this.vaultId,
      tools: MCP_TOOLS.map((tool) => tool.name),
      lastError: this.lastError,
    };
  }

  /** Attaching a new vault stops any listener tied to the old one. */
  async attachVault(vaultId: string, source: McpDataSource): Promise<void> {
    if (this.vaultId !== vaultId) await this.stop();
    this.vaultId = vaultId;
    this.source = source;
    this.lastError = null;
  }

  async detachVault(): Promise<void> {
    await this.stop();
    this.vaultId = null;
    this.source = null;
  }

  async start(port = 0): Promise<McpHostStatus> {
    if (!this.source || !this.vaultId) {
      throw new Error('An active vault is required before MCP can start');
    }
    if (this.server?.listening) return this.status;
    const server = new ReadOnlyMcpServer(this.source, { host: '127.0.0.1', port });
    try {
      await server.start();
      this.server = server;
      this.lastError = null;
      return this.status;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      await server.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await server.stop();
  }

  async shutdown(): Promise<void> {
    await this.detachVault();
  }
}
