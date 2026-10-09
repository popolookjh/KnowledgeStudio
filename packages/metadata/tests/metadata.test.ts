import { describe, expect, it } from 'vitest';
import {
  ensureDocumentId,
  readMetadata,
  serializeMetadata,
  writeMetadata,
  withUpdatedStamp,
} from '../src/index.js';

describe('readMetadata', () => {
  it('reads canonical properties with types intact', () => {
    const { data, issues } = readMetadata(
      '---\nid: 123e4567-e89b-42d3-a456-426614174000\ntitle: آزمایش\ntags: [a, b]\nconfidence: 0.9\n---\nbody',
    );
    expect(issues).toEqual([]);
    expect(data.id).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(data.title).toBe('آزمایش');
    expect(data.tags).toEqual(['a', 'b']);
    expect(data.confidence).toBe(0.9);
  });

  it('flags tags/aliases that are not string lists', () => {
    const { data, issues } = readMetadata('---\ntags: not-a-list\naliases: 3\n---\nbody');
    expect(issues.map((issue) => issue.key).sort()).toEqual(['aliases', 'tags']);
    expect(data.tags).toBeUndefined();
    expect(data.aliases).toBeUndefined();
  });

  it('flags non-numeric confidence', () => {
    const { issues } = readMetadata('---\nconfidence: high\n---\nbody');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.key).toBe('confidence');
  });

  it('survives invalid YAML without throwing', () => {
    const { data, issues } = readMetadata('---\nbad: [\n---\nbody');
    expect(data).toEqual({});
    expect(issues[0]?.message).toMatch(/Invalid YAML/);
  });

  it('returns empty metadata for notes without frontmatter', () => {
    expect(readMetadata('# plain note')).toEqual({ data: {}, issues: [] });
  });

  it('preserves unknown properties', () => {
    const { data } = readMetadata('---\ncustom:\n  nested: true\n---\nbody');
    expect(data['custom']).toEqual({ nested: true });
  });

  it('assigns a stable UUID lazily without changing the note body', () => {
    const result = ensureDocumentId('---\ntitle: فارسی\n---\nbody\n');
    if (!result.ok) throw new Error('identity assignment failed');
    expect(result.value.assigned).toBe(true);
    expect(result.value.documentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.value.content).toContain('body\n');
    const repeated = ensureDocumentId(result.value.content);
    if (!repeated.ok) throw new Error('identity read failed');
    expect(repeated.value.documentId).toBe(result.value.documentId);
    expect(repeated.value.assigned).toBe(false);
  });
});

describe('serializeMetadata', () => {
  it('orders canonical keys first, the rest alphabetically', () => {
    const yaml = serializeMetadata({ zebra: 1, title: 'T', alpha: 2 });
    const lines = yaml.split('\n');
    expect(lines.indexOf('title: T')).toBeLessThan(lines.indexOf('alpha: 2'));
    expect(lines.indexOf('alpha: 2')).toBeLessThan(lines.indexOf('zebra: 1'));
  });

  it('wraps the block in fences with a trailing newline', () => {
    expect(serializeMetadata({ title: 'X' })).toBe('---\ntitle: X\n---\n');
  });

  it('supports Persian values', () => {
    expect(serializeMetadata({ title: 'عنوان' })).toContain('title: عنوان');
  });
});

describe('writeMetadata', () => {
  it('preserves the body byte-for-byte when replacing frontmatter', () => {
    const note = '---\ntitle: old\n---\n\n# heading\n\nbody text\n';
    const updated = writeMetadata(note, { title: 'new' });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value).toContain('title: new');
      expect(updated.value.endsWith('\n# heading\n\nbody text\n')).toBe(true);
      // Round-trip: reading back yields exactly what we wrote.
      expect(readMetadata(updated.value).data.title).toBe('new');
    }
  });

  it('prepends frontmatter to notes that lack it', () => {
    const updated = writeMetadata('# body only', { title: 'Added' });
    expect(updated.ok && updated.value.startsWith('---\n')).toBe(true);
    expect(updated.ok && updated.value.endsWith('# body only')).toBe(true);
  });

  it('rejects invalid patches without touching anything', () => {
    const result = writeMetadata('---\n---\nbody', { tags: 'nope' as unknown as string[] });
    expect(result.ok).toBe(false);
  });

  it('keeps unknown properties through the round trip', () => {
    const note = '---\ntitle: keep\ncustom-field: [x, y]\n---\nbody';
    const updated = writeMetadata(note, {
      ...readMetadata(note).data,
      status: 'draft',
    });
    expect(updated.ok && updated.value).toContain('custom-field:');
    expect(updated.ok && updated.value).toContain('status: draft');
  });
});

describe('withUpdatedStamp', () => {
  it('sets an ISO timestamp', () => {
    const stamped = withUpdatedStamp({ title: 'x' }, new Date('2026-09-01T10:00:00Z'));
    expect(stamped.updated).toBe('2026-09-01T10:00:00.000Z');
  });
});
