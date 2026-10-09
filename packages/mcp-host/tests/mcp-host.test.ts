import { afterEach, describe, expect, it } from 'vitest';
import { type McpDataSource } from '@knowledge-studio/mcp';
import { ActiveVaultMcpHost } from '../src/index.js';

const source: McpDataSource = {
  searchNotes: () => Promise.resolve([]),
  readNote: () => Promise.resolve(null),
  listNotes: () => Promise.resolve([]),
  getMetadata: () => Promise.resolve(null),
  getBacklinks: () => Promise.resolve([]),
  getOutgoingLinks: () => Promise.resolve([]),
  searchTags: () => Promise.resolve([]),
  retrieve: () => Promise.resolve([]),
  resolveCitation: () => Promise.resolve(null),
  listChanges: () => Promise.resolve({ cursor: 'v1:x:0', changes: [], hasMore: false }),
  listAnnotations: () => Promise.resolve({ annotations: [] }),
  queryBase: () => Promise.resolve({ rows: [] }),
};

let host: ActiveVaultMcpHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

describe('ActiveVaultMcpHost', () => {
  it('requires an active vault and binds only loopback on explicit start', async () => {
    host = new ActiveVaultMcpHost();
    await expect(host.start()).rejects.toThrow(/active vault/);
    await host.attachVault('vault-a', source);
    const status = await host.start();
    expect(status.running).toBe(true);
    expect(status.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(status.tools).toHaveLength(12);
  });

  it('stops on active-vault change and restarts only after explicit start', async () => {
    host = new ActiveVaultMcpHost();
    await host.attachVault('vault-a', source);
    await host.start();
    expect(host.status.running).toBe(true);
    await host.attachVault('vault-b', source);
    expect(host.status.running).toBe(false);
    expect(host.status.vaultId).toBe('vault-b');
  });

  it('cleans up listener and vault reference on shutdown', async () => {
    host = new ActiveVaultMcpHost();
    await host.attachVault('vault-a', source);
    await host.start();
    await host.shutdown();
    expect(host.status).toMatchObject({ running: false, endpoint: null, vaultId: null });
  });
});
