import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RevisionStore } from '@knowledge-studio/history';
import { Vault } from '@knowledge-studio/vault';
import { BasesHost } from '../electron/bases-host';
import { TrustedNoteWriter } from '../electron/trusted-note-writer';

let root = '';
let vault: Vault;
let writer: TrustedNoteWriter;
let host: BasesHost;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-bases-host-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
  await mkdir(path.join(root, 'Projects'));
  await writeFile(path.join(root, 'Projects', 'Alpha.md'), '---\ntitle: Alpha\nstatus: todo\n---\nAlpha body stays private\n');
  await writeFile(path.join(root, 'Projects', 'پروژه.md'), '---\ntitle: پروژه نمونه\nstatus: doing\n---\nمتن\n');
  await writeFile(path.join(root, 'Loose.md'), '---\nstatus: todo\n---\n');
  writer = new TrustedNoteWriter(vault, new RevisionStore(path.join(vault.appDir, 'history')));
  host = new BasesHost(writer);
});

afterEach(async () => {
  vault.close();
  await rm(root, { recursive: true, force: true });
});

const definition = { schemaVersion: 1, id: 'projects', name: 'پروژه‌ها', view: 'kanban', folder: 'Projects', filters: [], fields: ['status'], groupBy: 'status' };

describe('BasesHost', () => {
  it('rejects malformed renderer input before touching the vault', async () => {
    expect((await host.save({ ...definition, id: '../x' }, undefined)).ok).toBe(false);
    expect((await host.save('not an object', undefined)).ok).toBe(false);
    expect((await host.query('../../etc')).ok).toBe(false);
    expect((await host.setField({ path: 'Projects/Alpha.md', key: 'id', value: 'x', expectedMtimeMs: 1 })).ok).toBe(false);
    expect((await host.remove(42, 1)).ok).toBe(false);
  });

  it('saves, lists, queries metadata rows without bodies, and changes view with revisions', async () => {
    const saved = await host.save(definition, undefined);
    expect(saved.ok && saved.value.revision).toBe(1);
    const listed = await host.list();
    expect(listed.ok && listed.value.map((base) => base.name)).toEqual(['پروژه‌ها']);
    const queried = await host.query('projects');
    if (!queried.ok) throw new Error(queried.error.message);
    expect(queried.value.total).toBe(2);
    expect(queried.value.rows.map((row) => row.title)).toEqual(['Alpha', 'پروژه نمونه']);
    expect(JSON.stringify(queried.value)).not.toContain('Alpha body stays private');
    expect((await host.save({ ...definition, view: 'table' }, 0)).ok).toBe(false);
    expect((await host.save({ ...definition, view: 'table' }, 1)).ok).toBe(true);
  });

  it('edits metadata through the trusted path with concurrency, history, identity and change feed', async () => {
    await host.save(definition, undefined);
    const queried = await host.query('projects');
    if (!queried.ok) throw new Error('query failed');
    const alpha = queried.value.rows.find((row) => row.title === 'Alpha')!;
    const stale = await host.setField({ path: alpha.path, key: 'status', value: 'done', expectedMtimeMs: alpha.mtimeMs - 10_000 });
    expect(stale.ok || stale.error.code).toBe('VAULT_MODIFIED_SINCE_READ');
    const edited = await host.setField({ path: alpha.path, key: 'status', value: 'done', expectedMtimeMs: alpha.mtimeMs });
    expect(edited.ok).toBe(true);
    const content = await readFile(path.join(root, 'Projects', 'Alpha.md'), 'utf8');
    expect(content).toContain('status: done');
    expect(content).toMatch(/^---\nid: [0-9a-f-]{36}\n/);
    expect(content.endsWith('Alpha body stays private\n')).toBe(true);
    const revisions = await new RevisionStore(path.join(vault.appDir, 'history')).list('Projects/Alpha.md');
    expect(revisions).toHaveLength(1);
    const feed = await writer.feed.changesSince();
    expect(feed.ok && feed.value.changes.map((change) => [change.type, change.path, change.metadata?.['field']])).toEqual([['metadata_changed', 'Projects/Alpha.md', 'status']]);
    const persian = queried.value.rows.find((row) => row.title === 'پروژه نمونه')!;
    expect((await host.setField({ path: persian.path, key: 'وضعیت', value: 'انجام شد', expectedMtimeMs: persian.mtimeMs })).ok).toBe(true);
    expect(await readFile(path.join(root, 'Projects', 'پروژه.md'), 'utf8')).toContain('وضعیت: انجام شد');
  });

  it('serializes concurrent change-feed appends without losing sequences', async () => {
    await Promise.all(Array.from({ length: 20 }, (_unused, index) => writer.recordChange({ type: 'document_updated', path: `n${index}.md` })));
    const feed = await writer.feed.changesSince(undefined, 100);
    expect(feed.ok && feed.value.changes.map((change) => change.sequence)).toEqual(Array.from({ length: 20 }, (_unused, index) => index + 1));
  });
});
