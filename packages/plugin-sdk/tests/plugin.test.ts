import { describe, expect, it, vi } from 'vitest';
import { createCapabilities, evaluatePlugin, EXAMPLE_PLUGIN_MANIFEST, parsePluginManifest, PluginPermission } from '../src/index.js';

const base = { id: 'test.plugin', name: 'Test', version: '1.0.0', description: 'x', permissions: [], trusted: true };

describe('plugin manifests', () => {
  it('parses valid manifests and defaults fields', () => { const result = parsePluginManifest({ id: 'demo.test', name: 'Demo', version: '1.0.0' }); expect(result.ok).toBe(true); if (result.ok) expect(result.value.permissions).toEqual([]); });
  it('rejects invalid IDs and versions', () => { expect(parsePluginManifest({ ...base, id: 'Bad ID' }).ok).toBe(false); expect(parsePluginManifest({ ...base, version: 'latest' }).ok).toBe(false); });
  it('exposes the harmless example plugin', () => { expect(EXAMPLE_PLUGIN_MANIFEST.permissions).toEqual(['VAULT_READ']); });
});

describe('plugin policy', () => {
  it('default-denies untrusted plugins', () => { expect(evaluatePlugin({ ...base, trusted: false }).enabled).toBe(false); });
  it('requires approval for high-risk permissions', () => { const status = evaluatePlugin({ ...base, permissions: ['PROCESS_EXECUTE'] }); expect(status.enabled).toBe(false); expect(status.reason).toMatch(/High-risk/); });
  it('enables trusted approved plugins', () => { expect(evaluatePlugin({ ...base, permissions: ['SECRETS'] }, { approvedHighRisk: ['SECRETS'] }).enabled).toBe(true); });
});

describe('scoped capabilities', () => {
  const handlers = { vault: { read: vi.fn(), list: vi.fn(), write: vi.fn(), delete: vi.fn(), rename: vi.fn() }, registerCommand: vi.fn(), readIndex: vi.fn() };
  it('only exposes declared permissions', () => { const capabilities = createCapabilities({ ...base, permissions: ['VAULT_READ', 'COMMAND_REGISTER'] }, handlers); expect(capabilities.vault.read).toBe(handlers.vault.read); expect(capabilities.vault.write).toBeUndefined(); expect(capabilities.registerCommand).toBe(handlers.registerCommand); expect(capabilities.readIndex).toBeUndefined(); });
  it('maps all vault permission categories explicitly', () => { const capabilities = createCapabilities({ ...base, permissions: ['VAULT_READ', 'VAULT_WRITE', 'VAULT_DELETE', 'VAULT_RENAME', 'INDEX_READ'] }, handlers); expect(Object.keys(capabilities.vault).sort()).toEqual(['delete', 'list', 'read', 'rename', 'write']); expect(capabilities.readIndex).toBe(handlers.readIndex); });
});

void PluginPermission;
