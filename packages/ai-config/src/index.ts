import fs from 'node:fs/promises';
import path from 'node:path';
import { validateDisclosure, type AIPrivacyDisclosure } from '@knowledge-studio/ai-bridge';

export type ProviderKind = 'local' | 'external';

/** Non-secret provider configuration persisted as ordinary JSON. */
export interface ProviderConfig {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  readonly endpoint?: string;
  readonly model?: string;
  readonly enabled: boolean;
  readonly semanticSearchEnabled: boolean;
  readonly sendsVaultContent: boolean;
  readonly disclosureConfirmed: boolean;
  /** Presence only; secret plaintext never appears in config or renderer DTOs. */
  readonly hasSecret: boolean;
}

interface ConfigFile {
  readonly version: 1;
  readonly providers: readonly ProviderConfig[];
}

const EMPTY: ConfigFile = { version: 1, providers: [] };

/** Secure secret abstraction: no plaintext fallback is permitted. */
export interface SecureSecretStore {
  readonly available: boolean;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export class ProviderConfigStore {
  constructor(
    private readonly configPath: string,
    private readonly secrets: SecureSecretStore,
  ) {}

  async list(): Promise<readonly ProviderConfig[]> {
    return (await this.read()).providers;
  }

  async upsert(config: Omit<ProviderConfig, 'hasSecret'>): Promise<ProviderConfig> {
    this.validate(config);
    const previous = await this.read();
    const hasSecret = await this.secrets.has(this.secretKey(config.id));
    const next: ProviderConfig = { ...config, hasSecret };
    const providers = [
      ...previous.providers.filter((provider) => provider.id !== config.id),
      next,
    ].sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'));
    await this.write({ version: 1, providers });
    return next;
  }

  async setSecret(providerId: string, secret: string): Promise<ProviderConfig> {
    if (!this.secrets.available)
      throw new Error('OS-backed secure storage is unavailable; provider secret was not saved');
    if (secret.length === 0) throw new Error('Provider secret cannot be empty');
    const file = await this.read();
    const provider = file.providers.find((entry) => entry.id === providerId);
    if (!provider) throw new Error('Provider must be configured before adding a secret');
    await this.secrets.set(this.secretKey(providerId), secret);
    const { hasSecret: _ignored, ...config } = provider;
    return this.upsert(config);
  }

  async removeSecret(providerId: string): Promise<ProviderConfig> {
    const file = await this.read();
    const provider = file.providers.find((entry) => entry.id === providerId);
    if (!provider) throw new Error('Provider is not configured');
    await this.secrets.delete(this.secretKey(providerId));
    const { hasSecret: _ignored, ...config } = provider;
    return this.upsert(config);
  }

  private validate(config: Omit<ProviderConfig, 'hasSecret'>): void {
    if (!/^[a-z][a-z0-9._-]+$/.test(config.id)) throw new Error('Provider id is invalid');
    if (config.kind === 'external' && !config.endpoint)
      throw new Error('External providers require an explicit endpoint');
    if (config.kind === 'local' && config.endpoint)
      throw new Error('Local providers must not declare a remote endpoint');
    const disclosure: AIPrivacyDisclosure = {
      providerId: config.id,
      remote: config.kind === 'external',
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      sendsVaultContent: config.sendsVaultContent,
      userConfirmed: config.disclosureConfirmed,
    };
    const result = validateDisclosure(disclosure);
    if (!result.ok) throw new Error(result.error);
  }

  private secretKey(providerId: string): string {
    return `knowledge-studio.provider.${providerId}`;
  }

  private async read(): Promise<ConfigFile> {
    const raw = await fs.readFile(this.configPath, 'utf8').catch(() => null);
    if (raw === null) return EMPTY;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return EMPTY;
      const record = parsed as Record<string, unknown>;
      if (record['version'] !== 1 || !Array.isArray(record['providers'])) return EMPTY;
      return parsed as ConfigFile;
    } catch {
      return EMPTY;
    }
  }

  private async write(file: ConfigFile): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    const temp = `${this.configPath}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.configPath);
  }
}
