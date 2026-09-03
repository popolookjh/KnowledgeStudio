import { z } from 'zod';

/**
 * Plugin security contract. Plugins declare permissions and receive only a
 * scoped capability object containing those permissions. Untrusted plugins
 * are never auto-enabled; PROCESS_EXECUTE and SECRETS require explicit
 * application policy approval.
 */

export const PluginPermission = {
  VAULT_READ: 'VAULT_READ',
  VAULT_WRITE: 'VAULT_WRITE',
  VAULT_DELETE: 'VAULT_DELETE',
  VAULT_RENAME: 'VAULT_RENAME',
  METADATA_READ: 'METADATA_READ',
  METADATA_WRITE: 'METADATA_WRITE',
  NETWORK: 'NETWORK',
  COMMAND_REGISTER: 'COMMAND_REGISTER',
  UI_PANEL: 'UI_PANEL',
  INDEX_READ: 'INDEX_READ',
  PROCESS_EXECUTE: 'PROCESS_EXECUTE',
  SECRETS: 'SECRETS',
} as const;

export type PluginPermission = (typeof PluginPermission)[keyof typeof PluginPermission];

export const PluginManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9.-]+$/),
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/),
  description: z.string().max(500).default(''),
  permissions: z.array(z.enum(Object.values(PluginPermission) as [PluginPermission, ...PluginPermission[]])).default([]),
  trusted: z.boolean().default(false),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export interface PluginStatus {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface VaultCapability {
  read(this: void, path: string): Promise<string>;
  list(this: void): Promise<readonly string[]>;
  write(this: void, path: string, content: string): Promise<void>;
  delete(this: void, path: string): Promise<void>;
  rename(this: void, from: string, to: string): Promise<void>;
}

export interface PluginCapabilities {
  readonly vault: Partial<VaultCapability>;
  readonly registerCommand?: (command: { id: string; title: string; execute: () => void }) => void;
  readonly readIndex?: (query: string) => Promise<readonly unknown[]>;
}

const HIGH_RISK = new Set<PluginPermission>(['PROCESS_EXECUTE', 'SECRETS']);

/** Validates a manifest and returns structured issues rather than throwing. */
export function parsePluginManifest(raw: unknown): { ok: true; value: PluginManifest } | { ok: false; errors: readonly string[] } {
  const parsed = PluginManifestSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
}

/**
 * Applies application policy: untrusted plugins are disabled, and high-risk
 * permissions are stripped unless explicitly approved by policy.
 */
export function evaluatePlugin(manifest: PluginManifest, policy?: { allowUntrusted?: boolean; approvedHighRisk?: readonly PluginPermission[] }): PluginStatus {
  if (!manifest.trusted && !policy?.allowUntrusted) return { manifest, enabled: false, reason: 'Plugin is not trusted by the application' };
  const approved = new Set(policy?.approvedHighRisk ?? []);
  const blocked = manifest.permissions.filter((permission) => HIGH_RISK.has(permission) && !approved.has(permission));
  if (blocked.length > 0) return { manifest, enabled: false, reason: `High-risk permissions require approval: ${blocked.join(', ')}` };
  return { manifest, enabled: true };
}

/** Creates a least-privilege capability object from an approved manifest. */
export function createCapabilities(manifest: PluginManifest, handlers: { vault: VaultCapability; registerCommand: PluginCapabilities['registerCommand']; readIndex: PluginCapabilities['readIndex'] }): PluginCapabilities {
  const permissions = new Set(manifest.permissions);
  const vault: Partial<VaultCapability> = {};
  if (permissions.has('VAULT_READ')) { vault.read = handlers.vault.read; vault.list = handlers.vault.list; }
  if (permissions.has('VAULT_WRITE')) vault.write = handlers.vault.write;
  if (permissions.has('VAULT_DELETE')) vault.delete = handlers.vault.delete;
  if (permissions.has('VAULT_RENAME')) vault.rename = handlers.vault.rename;
  return {
    vault,
    ...(permissions.has('COMMAND_REGISTER') && handlers.registerCommand ? { registerCommand: handlers.registerCommand } : {}),
    ...(permissions.has('INDEX_READ') && handlers.readIndex ? { readIndex: handlers.readIndex } : {}),
  };
}

/** Harmless sample plugin manifest for SDK integration tests/examples. */
export const EXAMPLE_PLUGIN_MANIFEST: PluginManifest = {
  id: 'example.word-count', name: 'Word Count', version: '1.0.0', description: 'Counts words in the active note.', permissions: ['VAULT_READ'], trusted: true,
};
