import fs from 'node:fs/promises';
import path from 'node:path';
import {
  evaluatePlugin,
  parsePluginManifest,
  type PluginManifest,
  type PluginPermission,
} from '@knowledge-studio/plugin-sdk';

/**
 * Main-process local plugin host. It discovers manifests inside one explicit
 * application-owned directory and persists approval choices. It NEVER loads
 * or executes plugin modules; safe runtime isolation is intentionally deferred.
 */

export interface StoredPluginPolicy {
  readonly enabled: boolean;
  readonly approvedHighRisk: readonly PluginPermission[];
}

export interface PluginHostEntry {
  readonly manifest: PluginManifest;
  readonly directory: string;
  readonly enabled: boolean;
  readonly requestedPermissions: readonly PluginPermission[];
  readonly approvedHighRisk: readonly PluginPermission[];
  readonly reason?: string;
  readonly runtime: 'deferred';
}

interface PluginStateFile {
  readonly version: 1;
  readonly plugins: Readonly<Record<string, StoredPluginPolicy>>;
}

const EMPTY_STATE: PluginStateFile = { version: 1, plugins: {} };
const MANIFEST_FILE = 'manifest.json';
const STATE_FILE = 'plugin-state.json';

export class LocalPluginHost {
  constructor(
    readonly pluginsDirectory: string,
    readonly stateDirectory: string,
  ) {}

  private get statePath(): string {
    return path.join(this.stateDirectory, STATE_FILE);
  }

  async discover(): Promise<readonly PluginHostEntry[]> {
    await fs.mkdir(this.pluginsDirectory, { recursive: true });
    const state = await this.readState();
    const entries = await fs.readdir(this.pluginsDirectory, { withFileTypes: true });
    const discovered: PluginHostEntry[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(this.pluginsDirectory, entry.name);
      const raw = await fs.readFile(path.join(directory, MANIFEST_FILE), 'utf8').catch(() => null);
      if (raw === null) continue;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        continue;
      }
      const manifestResult = parsePluginManifest(parsedJson);
      if (!manifestResult.ok) continue;
      const manifest = manifestResult.value;
      const stored = state.plugins[manifest.id] ?? { enabled: false, approvedHighRisk: [] };
      // Discovery does not grant trust. A local manifest declares `trusted`,
      // but enablement still defaults false until explicit app approval.
      const evaluation = evaluatePlugin(manifest, {
        allowUntrusted: stored.enabled && manifest.trusted,
        approvedHighRisk: stored.approvedHighRisk,
      });
      discovered.push({
        manifest,
        directory,
        enabled: stored.enabled && evaluation.enabled,
        requestedPermissions: manifest.permissions,
        approvedHighRisk: stored.approvedHighRisk,
        ...(evaluation.enabled
          ? {}
          : { reason: evaluation.reason ?? 'Plugin is disabled by policy' }),
        runtime: 'deferred',
      });
    }
    return discovered.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'en'));
  }

  async setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const state = await this.readState();
    const previous = state.plugins[pluginId] ?? { enabled: false, approvedHighRisk: [] };
    await this.writeState({
      version: 1,
      plugins: { ...state.plugins, [pluginId]: { ...previous, enabled } },
    });
  }

  async approveHighRisk(
    pluginId: string,
    permission: PluginPermission,
    approved: boolean,
  ): Promise<void> {
    if (permission !== 'PROCESS_EXECUTE' && permission !== 'SECRETS') {
      throw new Error('Only high-risk permissions require stored approval');
    }
    const state = await this.readState();
    const previous = state.plugins[pluginId] ?? { enabled: false, approvedHighRisk: [] };
    const next = new Set(previous.approvedHighRisk);
    if (approved) next.add(permission);
    else next.delete(permission);
    await this.writeState({
      version: 1,
      plugins: {
        ...state.plugins,
        [pluginId]: { ...previous, approvedHighRisk: [...next].sort() },
      },
    });
  }

  private async readState(): Promise<PluginStateFile> {
    const raw = await fs.readFile(this.statePath, 'utf8').catch(() => null);
    if (raw === null) return EMPTY_STATE;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return EMPTY_STATE;
      const record = parsed as Record<string, unknown>;
      if (
        record['version'] !== 1 ||
        typeof record['plugins'] !== 'object' ||
        record['plugins'] === null
      )
        return EMPTY_STATE;
      return parsed as PluginStateFile;
    } catch {
      return EMPTY_STATE;
    }
  }

  private async writeState(state: PluginStateFile): Promise<void> {
    await fs.mkdir(this.stateDirectory, { recursive: true });
    const temp = `${this.statePath}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(temp, this.statePath);
  }
}
