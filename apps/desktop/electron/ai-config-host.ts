import path from 'node:path';
import { type ProviderConfig, ProviderConfigStore } from '@knowledge-studio/ai-config';
import { ElectronSafeSecretStore, type SafeStorageCodec } from './secure-secret-store.js';

/** Main-process AI configuration owner. Reading/upserting metadata has no network side effects. */
export class ElectronAiConfigHost {
  private readonly store: ProviderConfigStore;

  constructor(
    userDataPath: string,
    private readonly safeStorage: SafeStorageCodec,
  ) {
    const configPath = path.join(userDataPath, 'ai-providers.json');
    const secretPath = path.join(userDataPath, 'ai-provider-secrets.json');
    this.store = new ProviderConfigStore(configPath, new ElectronSafeSecretStore(safeStorage, secretPath));
  }

  get secureStorageAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  async list(): Promise<readonly ProviderConfig[]> {
    return this.store.list();
  }

  async upsert(config: Omit<ProviderConfig, 'hasSecret'>): Promise<ProviderConfig> {
    return this.store.upsert(config);
  }
}
