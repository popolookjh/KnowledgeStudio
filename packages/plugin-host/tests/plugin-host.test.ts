import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalPluginHost } from '../src/index.js';

async function setup(): Promise<{
  root: string;
  plugins: string;
  state: string;
  host: LocalPluginHost;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ks-plugin-host-'));
  const plugins = path.join(root, 'plugins');
  const state = path.join(root, 'state');
  return { root, plugins, state, host: new LocalPluginHost(plugins, state) };
}

async function manifest(plugins: string, directory: string, value: unknown): Promise<void> {
  const dir = path.join(plugins, directory);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(value));
}

const trusted = {
  id: 'example.safe',
  name: 'Example Safe',
  version: '1.0.0',
  trusted: true,
  permissions: ['VAULT_READ'],
};

describe('LocalPluginHost', () => {
  it('discovers only manifests in the explicit app-owned plugin directory', async () => {
    const { root, plugins, host } = await setup();
    await manifest(plugins, 'safe', trusted);
    await writeFile(
      path.join(root, 'outside.json'),
      JSON.stringify({ ...trusted, id: 'outside.plugin' }),
    );
    const discovered = await host.discover();
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.manifest.id).toBe('example.safe');
    expect(discovered[0]?.enabled).toBe(false);
    expect(discovered[0]?.runtime).toBe('deferred');
    await rm(root, { recursive: true, force: true });
  });

  it('default-denies enablement and persists explicit choice', async () => {
    const { root, plugins, state, host } = await setup();
    await manifest(plugins, 'safe', trusted);
    expect((await host.discover())[0]?.enabled).toBe(false);
    await host.setEnabled('example.safe', true);
    expect((await host.discover())[0]?.enabled).toBe(true);
    const persisted = await readFile(path.join(state, 'plugin-state.json'), 'utf8');
    expect(persisted).toContain('"enabled": true');
    await rm(root, { recursive: true, force: true });
  });

  it('requires persisted explicit approval for high-risk permissions', async () => {
    const { root, plugins, host } = await setup();
    await manifest(plugins, 'sensitive', {
      ...trusted,
      id: 'example.sensitive',
      permissions: ['PROCESS_EXECUTE'],
    });
    await host.setEnabled('example.sensitive', true);
    expect((await host.discover())[0]?.enabled).toBe(false);
    await host.approveHighRisk('example.sensitive', 'PROCESS_EXECUTE', true);
    expect((await host.discover())[0]?.enabled).toBe(true);
    await host.approveHighRisk('example.sensitive', 'PROCESS_EXECUTE', false);
    expect((await host.discover())[0]?.enabled).toBe(false);
    await rm(root, { recursive: true, force: true });
  });

  it('ignores malformed manifests and never executes plugin code', async () => {
    const { root, plugins, host } = await setup();
    await manifest(plugins, 'broken', { id: 'Bad ID', version: 'x' });
    const entries = await host.discover();
    expect(entries).toEqual([]);
    await rm(root, { recursive: true, force: true });
  });
});
