import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVault } from '../src/index.js';
import type { Vault, VaultFileEvent } from '../src/index.js';

let vault: Vault;
let root: string;
let events: VaultFileEvent[];
let errors: Error[];

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'ks-watch-'));
  const created = await createVault(root);
  if (!created.ok) {
    throw new Error(`vault creation failed: ${String(created.error)}`);
  }
  vault = created.value;
  events = [];
  errors = [];
  const watched = await vault.watch({
    onFileEvent: (event) => events.push(event),
    onError: (error) => errors.push(error),
  });
  if (!watched.ok) {
    throw new Error(`watch failed: ${String(watched.error)}`);
  }
});

afterAll(() => {
  vault.close();
  rmSync(root, { recursive: true, force: true });
});

async function waitForEvent(
  predicate: (event: VaultFileEvent) => boolean,
  timeoutMs = 5000,
): Promise<VaultFileEvent> {
  return vi.waitFor(
    () => {
      const found = events.find(predicate);
      if (!found) {
        throw new Error('event not observed yet');
      }
      return found;
    },
    { timeout: timeoutMs, interval: 100 },
  );
}

describe('vault watcher', () => {
  it('reports externally created files', async () => {
    await writeFile(path.join(root, 'external-note.md'), 'created outside');
    const event = await waitForEvent((e) => e.vaultPath === 'external-note.md');
    expect(event.kind).toBe('created');
  });

  it('reports external modifications as changed', async () => {
    await vault.writeFile('notes/watched.md', 'version 1');
    await waitForEvent((e) => e.vaultPath === 'notes/watched.md' && e.kind === 'created');
    await writeFile(path.join(root, 'notes', 'watched.md'), 'version 2');
    await waitForEvent((e) => e.vaultPath === 'notes/watched.md' && e.kind === 'changed');
    const read = await vault.readFile('notes/watched.md');
    expect(read.ok && read.value.content).toBe('version 2');
  });

  it('reports deleted files', async () => {
    await vault.writeFile('notes/deleted.md', 'temp');
    await waitForEvent((e) => e.vaultPath === 'notes/deleted.md' && e.kind === 'created');
    const { rm } = await import('node:fs/promises');
    await rm(path.join(root, 'notes', 'deleted.md'));
    await waitForEvent((e) => e.vaultPath === 'notes/deleted.md' && e.kind === 'deleted');
  });

  it('ignores the application directory and temp files', async () => {
    await writeFile(path.join(vault.appDir, 'index.db'), 'index bytes');
    await vault.writeFile('notes/atomic.md', 'written via vault');
    await waitForEvent((e) => e.vaultPath === 'notes/atomic.md' && e.kind === 'created');
    // Give any (incorrect) app-dir event time to arrive before asserting.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(
      events.some(
        (e) => e.vaultPath.startsWith('.knowledge-studio') || e.vaultPath.includes('.ks-tmp-'),
      ),
    ).toBe(false);
  });

  it('does not surface watcher errors during normal operation', () => {
    expect(errors).toEqual([]);
  });

  it('supports Persian filenames in events', async () => {
    const persian = 'یادداشت‌ها/رصد.md';
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.join(root, 'یادداشت‌ها'), { recursive: true });
    await writeFile(path.join(root, 'یادداشت‌ها', 'رصد.md'), 'فارسی');
    const event = await waitForEvent((e) => e.vaultPath === persian);
    expect(event.kind).toBe('created');
  });
});
