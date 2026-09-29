import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Vault } from '@knowledge-studio/vault';
import { applyFieldEdit, collectBaseInputs, parseBaseDefinition, parseFieldEdit, queryBase, toRowView } from '../src/index.js';

const valid = { schemaVersion: 1, id: 'tasks', name: ' کارها ', view: 'kanban', filters: [{ field: 'status', op: 'exists' }], fields: ['status', 'وضعیت'], groupBy: 'status' };

describe('parseBaseDefinition', () => {
  it('accepts and normalizes a Persian kanban base', () => {
    const parsed = parseBaseDefinition(valid);
    expect(parsed.ok && parsed.value.name).toBe('کارها');
  });
  it.each([
    ['non-object', null],
    ['bad id', { ...valid, id: '../evil' }],
    ['bad view', { ...valid, view: 'html' }],
    ['kanban without group', { ...valid, groupBy: undefined }],
    ['absolute folder', { ...valid, folder: 'C:/Windows' }],
    ['traversal folder', { ...valid, folder: 'a/../b' }],
    ['bad filter op', { ...valid, filters: [{ field: 'status', op: 'eval' }] }],
    ['duplicate fields', { ...valid, fields: ['a', 'a'] }],
    ['bad field key', { ...valid, fields: ['<script>'] }],
  ])('rejects %s', (_name, value) => {
    expect(parseBaseDefinition(value).ok).toBe(false);
  });
});

describe('parseFieldEdit', () => {
  it('accepts scalar and list edits and rejects identity/virtual fields', () => {
    expect(parseFieldEdit({ path: 'a.md', key: 'status', value: 'done', expectedMtimeMs: 1 }).ok).toBe(true);
    expect(parseFieldEdit({ path: 'a.md', key: 'tags', value: ['x'], expectedMtimeMs: 1 }).ok).toBe(true);
    expect(parseFieldEdit({ path: 'a.md', key: 'id', value: 'x', expectedMtimeMs: 1 }).ok).toBe(false);
    expect(parseFieldEdit({ path: 'a.md', key: 'path', value: 'x', expectedMtimeMs: 1 }).ok).toBe(false);
    expect(parseFieldEdit({ path: 'a.txt', key: 'status', value: 'x', expectedMtimeMs: 1 }).ok).toBe(false);
    expect(parseFieldEdit({ path: 'a.md', key: 'status', value: { nested: true }, expectedMtimeMs: 1 }).ok).toBe(false);
    expect(parseFieldEdit({ path: 'a.md', key: 'status', value: 'x' }).ok).toBe(false);
  });
});

describe('applyFieldEdit', () => {
  it('rewrites only frontmatter and preserves unknown properties and body bytes', () => {
    const content = '---\nstatus: todo\ncustom:\n  nested: 1\n---\n# Body\nکلمه\n';
    const edited = applyFieldEdit(content, 'status', 'done');
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value).toContain('status: done');
    expect(edited.value).toContain('nested: 1');
    expect(edited.value.endsWith('# Body\nکلمه\n')).toBe(true);
    const removed = applyFieldEdit(edited.value, 'status', '');
    expect(removed.ok && removed.value.includes('status')).toBe(false);
    const tags = applyFieldEdit(content, 'tags', 'a, b');
    expect(tags.ok && tags.value).toContain('- a');
    expect(applyFieldEdit(content, 'confidence', 'high').ok).toBe(false);
  });
});

describe('collectBaseInputs + toRowView', () => {
  it('collects vault notes with mtimes and projects only requested fields', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ks-base-rows-'));
    const opened = await Vault.create(root);
    if (!opened.ok) throw opened.error;
    await mkdir(path.join(root, 'Projects'));
    await writeFile(path.join(root, 'Projects', 'a.md'), '---\nstatus: open\nsecret: hidden\n---\nPRIVATE BODY\n');
    await writeFile(path.join(root, 'other.md'), '---\nstatus: open\n---\n');
    const inputs = await collectBaseInputs(opened.value, 'Projects');
    expect(inputs.map((input) => input.path)).toEqual(['Projects/a.md']);
    const rows = queryBase({ schemaVersion: 1, id: 'p', name: 'P', view: 'table', filters: [], fields: ['status'] }, inputs);
    const view = toRowView(rows[0]!, ['status', 'missing']);
    expect(view.values).toEqual({ status: 'open', missing: null });
    expect(view.mtimeMs).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain('PRIVATE BODY');
    expect(JSON.stringify(view)).not.toContain('hidden');
    opened.value.close();
    await rm(root, { recursive: true, force: true });
  });
});
