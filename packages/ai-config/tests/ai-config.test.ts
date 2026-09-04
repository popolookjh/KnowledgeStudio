import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderConfigStore, type SecureSecretStore } from '../src/index.js';

class FakeSecureStore implements SecureSecretStore {
  readonly values = new Map<string, string>();
  constructor(readonly available = true) {}
  set(key: string, value: string): Promise<void> { this.values.set(key, value); return Promise.resolve(); }
  delete(key: string): Promise<void> { this.values.delete(key); return Promise.resolve(); }
  has(key: string): Promise<boolean> { return Promise.resolve(this.values.has(key)); }
}

const local = { id: 'local.echo', displayName: 'Local Echo', kind: 'local' as const, enabled: false, semanticSearchEnabled: false, sendsVaultContent: false, disclosureConfirmed: false };
const external = { id: 'external.example', displayName: 'External Example', kind: 'external' as const, endpoint: 'https://provider.example', model: 'example-1', enabled: false, semanticSearchEnabled: false, sendsVaultContent: true, disclosureConfirmed: true };

describe('ProviderConfigStore', () => {
  it('is disabled-by-default and writes only non-secret config', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-ai-config-')); const secure = new FakeSecureStore(); const store = new ProviderConfigStore(path.join(dir, 'providers.json'), secure);
    const saved = await store.upsert(local); expect(saved.enabled).toBe(false); expect(saved.hasSecret).toBe(false); const raw = await readFile(path.join(dir, 'providers.json'), 'utf8'); expect(raw).not.toContain('secret'); await rm(dir, { recursive: true, force: true });
  });
  it('requires disclosure before external vault content transmission', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-ai-config-')); const store = new ProviderConfigStore(path.join(dir, 'providers.json'), new FakeSecureStore());
    await expect(store.upsert({ ...external, disclosureConfirmed: false })).rejects.toThrow(/confirmation/); await rm(dir, { recursive: true, force: true });
  });
  it('does not accept external endpoint for a local provider', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-ai-config-')); const store = new ProviderConfigStore(path.join(dir, 'providers.json'), new FakeSecureStore());
    await expect(store.upsert({ ...local, endpoint: 'https://not-local' })).rejects.toThrow(/Local providers/); await rm(dir, { recursive: true, force: true });
  });
  it('uses secure storage for secrets and never writes plaintext', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-ai-config-')); const secure = new FakeSecureStore(); const configPath = path.join(dir, 'providers.json'); const store = new ProviderConfigStore(configPath, secure);
    await store.upsert(external); const withSecret = await store.setSecret(external.id, 'very-secret-token'); expect(withSecret.hasSecret).toBe(true); expect([...secure.values.values()]).toEqual(['very-secret-token']); expect(await readFile(configPath, 'utf8')).not.toContain('very-secret-token'); await store.removeSecret(external.id); expect((await store.list())[0]?.hasSecret).toBe(false); await rm(dir, { recursive: true, force: true });
  });
  it('refuses secrets when OS-backed storage is unavailable', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-ai-config-')); const store = new ProviderConfigStore(path.join(dir, 'providers.json'), new FakeSecureStore(false)); await store.upsert(external); await expect(store.setSecret(external.id, 'x')).rejects.toThrow(/secure storage/); await rm(dir, { recursive: true, force: true });
  });
});
