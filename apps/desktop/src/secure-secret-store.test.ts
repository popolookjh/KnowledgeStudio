import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ElectronSafeSecretStore } from '../electron/secure-secret-store';

const codec = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
};

describe('ElectronSafeSecretStore', () => {
  it('persists only encrypted blob values', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-electron-secret-'));
    const file = path.join(dir, 'secrets.json');
    const store = new ElectronSafeSecretStore(codec, file);
    await store.set('provider', 'plain-secret');
    expect(await store.has('provider')).toBe(true);
    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('plain-secret');
    expect(raw).toContain(Buffer.from('encrypted:plain-secret').toString('base64'));
    await store.delete('provider');
    expect(await store.has('provider')).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
  it('fails closed when platform encryption is unavailable', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'ks-electron-secret-'));
    const store = new ElectronSafeSecretStore(
      { ...codec, isEncryptionAvailable: () => false },
      path.join(dir, 'secrets.json'),
    );
    await expect(store.set('x', 'secret')).rejects.toThrow(/unavailable/);
    await rm(dir, { recursive: true, force: true });
  });
});
