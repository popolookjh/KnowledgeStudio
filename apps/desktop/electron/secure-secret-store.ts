import fs from 'node:fs/promises';
import path from 'node:path';
import type { SecureSecretStore } from '@knowledge-studio/ai-config';

/** Minimal testable facade over Electron safeStorage. */
export interface SafeStorageCodec {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
}

/**
 * Persists only OS-encrypted blobs. On Windows Electron safeStorage uses
 * platform credential protection; if unavailable we fail closed—never fall
 * back to plaintext, an environment variable, renderer state, or logs.
 */
export class ElectronSafeSecretStore implements SecureSecretStore {
  constructor(
    private readonly codec: SafeStorageCodec,
    private readonly storagePath: string,
  ) {}

  get available(): boolean {
    return this.codec.isEncryptionAvailable();
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.available) throw new Error('OS-backed secure storage is unavailable');
    const values = await this.read();
    values[key] = this.codec.encryptString(value).toString('base64');
    await this.write(values);
  }

  async delete(key: string): Promise<void> {
    const values = await this.read();
    delete values[key];
    await this.write(values);
  }

  async has(key: string): Promise<boolean> {
    return Object.hasOwn(await this.read(), key);
  }

  private async read(): Promise<Record<string, string>> {
    const raw = await fs.readFile(this.storagePath, 'utf8').catch(() => null);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
    } catch {
      return {};
    }
  }

  private async write(values: Record<string, string>): Promise<void> {
    await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
    const temp = `${this.storagePath}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.storagePath);
  }
}
