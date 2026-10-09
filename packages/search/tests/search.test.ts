import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SearchIndex, buildMatchExpression } from '../src/index.js';

let dir: string;
let index: SearchIndex;

const NOTES = [
  {
    path: 'notes/architecture.md',
    content:
      '---\ntitle: معماری سیستم\ntags: [design, core]\n---\n# Architecture\n\nThe indexer rebuilds from Markdown. بازسازی کامل ممکن است.',
  },
  {
    path: 'notes/persian-note.md',
    content:
      '---\ntitle: یادداشت فارسی\naliases: [farsi note]\n---\nسلام دنیا. این یک یادداشت آزمایشی است.',
  },
  {
    path: 'projects/alpha.md',
    content: '# Alpha\n\nProject planning notes with deadlines.',
  },
];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ks-search-'));
  index = new SearchIndex();
  const opened = index.open(path.join(dir, 'index.db'));
  if (!opened.ok) {
    throw new Error(String(opened.error));
  }
  const rebuilt = index.rebuild(NOTES);
  if (!rebuilt.ok) {
    throw new Error(String(rebuilt.error));
  }
});

afterAll(() => {
  index.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SearchIndex basics', () => {
  it('indexes every note', () => {
    expect(index.size()).toBe(3);
  });

  it('finds body text with snippets and ranking', () => {
    const result = index.search('deadlines');
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value).toHaveLength(1);
    const hit = result.value[0]!;
    expect(hit.path).toBe('projects/alpha.md');
    expect(hit.snippet).toContain('«deadlines»');
  });

  it('matches title from frontmatter', () => {
    const result = index.search('معماری');
    expect(result.ok && result.value[0]?.path).toBe('notes/architecture.md');
  });

  it('searches Persian content', () => {
    const result = index.search('آزمایشی');
    expect(result.ok && result.value[0]?.path).toBe('notes/persian-note.md');
  });

  it('matches aliases and tags through column filters', () => {
    const byAlias = index.search('farsi', { fields: ['aliases'] });
    expect(byAlias.ok && byAlias.value[0]?.path).toBe('notes/persian-note.md');
    const byTag = index.search('design', { fields: ['tags'] });
    expect(byTag.ok && byTag.value[0]?.path).toBe('notes/architecture.md');
  });

  it('prefix-matches partial words', () => {
    const result = index.search('rebuil');
    expect(result.ok && result.value.some((hit) => hit.path === 'notes/architecture.md')).toBe(
      true,
    );
  });

  it('ANDs multiple tokens', () => {
    const result = index.search('project deadlines');
    expect(result.ok && result.value).toHaveLength(1);
    const none = index.search('project nonexistent-token');
    expect(none.ok && none.value).toHaveLength(0);
  });

  it('falls back to the filename stem as title when frontmatter lacks one', () => {
    const result = index.search('alpha');
    expect(result.ok && result.value[0]?.title.toLowerCase()).toContain('alpha');
  });

  it('returns empty results for blank queries without touching sqlite', () => {
    const result = index.search('   ');
    expect(result.ok && result.value).toEqual([]);
  });
});

describe('SearchIndex incremental updates', () => {
  it('upsert replaces old content (no stale hits)', () => {
    const updated = index.upsert({
      path: 'projects/alpha.md',
      content: '# Alpha\n\nCompletely different topic: quantums.',
    });
    expect(updated.ok).toBe(true);
    expect(index.size()).toBe(3);
    const stale = index.search('deadlines');
    expect(stale.ok && stale.value).toHaveLength(0);
    const fresh = index.search('quantums');
    expect(fresh.ok && fresh.value[0]?.path).toBe('projects/alpha.md');
    // restore
    const restored = index.upsert(NOTES[2]!);
    expect(restored.ok).toBe(true);
  });

  it('remove drops a note and rebuild restores it', () => {
    const removed = index.remove('notes/persian-note.md');
    expect(removed.ok).toBe(true);
    expect(index.size()).toBe(2);
    const missing = index.search('آزمایشی');
    expect(missing.ok && missing.value).toHaveLength(0);
    const rebuilt = index.rebuild(NOTES);
    expect(rebuilt.ok && rebuilt.value).toBe(3);
    const back = index.search('آزمایشی');
    expect(back.ok && back.value[0]?.path).toBe('notes/persian-note.md');
  });
});

describe('buildMatchExpression safety', () => {
  it('neutralizes FTS operators in user input', () => {
    expect(buildMatchExpression('foo"bar*', ['body'])).toBe('(body : "foobar"*)');
  });

  it('returns null for empty input', () => {
    expect(buildMatchExpression('  ', ['body'])).toBeNull();
  });

  it('ANDs tokens across all fields by default', () => {
    expect(buildMatchExpression('one two')).toBe('"one"* "two"*');
  });
});
