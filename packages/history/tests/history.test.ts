import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffText, RevisionStore } from '../src/index.js';

describe('RevisionStore', () => {
  it('records, lists, reads and restores revisions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ks-history-'));
    const store = new RevisionStore(root);
    const now = new Date('2026-09-04T10:00:00Z');
    const first = await store.record('notes/a.md', 'one', now);
    const second = await store.record('notes/a.md', 'two', new Date(now.getTime() + 1000));
    expect(first.sha256).not.toBe(second.sha256);
    expect((await store.list('notes/a.md')).map((r) => r.id)).toEqual([second.id, first.id]);
    expect(await store.read('notes/a.md', first.id)).toBe('one');
    expect(await store.restore('notes/a.md', second.id)).toBe('two');
    await rm(root, { recursive: true, force: true });
  });
  it('enforces retention', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ks-history-'));
    const store = new RevisionStore(root, 2);
    for (let i = 0; i < 5; i += 1)
      await store.record('a.md', String(i), new Date(2026, 0, 1, 0, 0, i));
    expect(await store.list('a.md')).toHaveLength(2);
    await rm(root, { recursive: true, force: true });
  });
  it('handles missing notes and revisions safely', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ks-history-'));
    const store = new RevisionStore(root);
    expect(await store.list('missing.md')).toEqual([]);
    expect(await store.read('missing.md', 'nope')).toBeNull();
    await rm(root, { recursive: true, force: true });
  });
});

describe('diffText', () => {
  it('reports same, removed and added lines', () => {
    expect(diffText('a\nb', 'a\nc\nd')).toEqual([
      { kind: 'same', text: 'a', line: 1 },
      { kind: 'removed', text: 'b', line: 2 },
      { kind: 'added', text: 'c', line: 2 },
      { kind: 'added', text: 'd', line: 3 },
    ]);
  });
});
