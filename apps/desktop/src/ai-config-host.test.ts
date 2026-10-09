import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ElectronAiConfigHost } from '../electron/ai-config-host';

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`cipher:${value}`),
};

describe('ElectronAiConfigHost', () => {
  it('persists only provider metadata and performs no activation', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-ai-host-'));
    const host = new ElectronAiConfigHost(dir, safeStorage);
    expect(host.secureStorageAvailable).toBe(true);
    const provider = await host.upsert({
      id: 'local.echo',
      displayName: 'Local Echo',
      kind: 'local',
      enabled: false,
      semanticSearchEnabled: false,
      sendsVaultContent: false,
      disclosureConfirmed: false,
    });
    expect(provider.hasSecret).toBe(false);
    expect(await host.list()).toHaveLength(1);
    const raw = await readFile(path.join(dir, 'ai-providers.json'), 'utf8');
    expect(raw).not.toContain('very-secret-token');
    await rm(dir, { recursive: true, force: true });
  });
});
