import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vault } from '@knowledge-studio/vault';
import { BaseStore, type BaseDefinition } from '../src/index.js';
const definition: BaseDefinition = {
  schemaVersion: 1,
  id: 'research',
  name: 'پژوهش',
  view: 'table',
  filters: [],
  fields: ['status'],
};
describe('BaseStore', () => {
  it('atomically persists vault-bound definitions and detects revision conflicts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ks-bases-'));
    const opened = await Vault.create(root);
    if (!opened.ok) throw opened.error;
    const store = new BaseStore(opened.value);
    const saved = await store.create(definition);
    expect(saved.ok && saved.value.revision).toBe(1);
    expect((await store.update(definition, 0)).ok).toBe(false);
    expect((await store.rename('research', 'تحقیقات', 1)).ok).toBe(true);
    expect((await store.remove('research', 2)).ok).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
});
