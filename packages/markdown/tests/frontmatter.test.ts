import { describe, expect, it } from 'vitest';
import { parseFrontmatter, readFrontmatter, splitFrontmatter } from '../src/index.js';

describe('splitFrontmatter', () => {
  it('splits a valid frontmatter block', () => {
    const split = splitFrontmatter('---\ntitle: Test\ntags: [a, b]\n---\n\n# Body\n');
    expect(split.frontmatter).toBe('title: Test\ntags: [a, b]');
    expect(split.body).toBe('\n# Body\n');
    expect(split.bodyStartLine).toBe(5);
  });

  it('accepts the ... closing fence', () => {
    const split = splitFrontmatter('---\ntitle: X\n...\nbody');
    expect(split.frontmatter).toBe('title: X');
    expect(split.body).toBe('body');
  });

  it('returns null frontmatter when the document does not start with a fence', () => {
    const split = splitFrontmatter('# Just a note\n---\nnot frontmatter\n---');
    expect(split.frontmatter).toBeNull();
    expect(split.body).toBe('# Just a note\n---\nnot frontmatter\n---');
  });

  it('treats an unterminated fence as body (never loses content)', () => {
    const content = '---\ntitle: broken\nno closing fence';
    const split = splitFrontmatter(content);
    expect(split.frontmatter).toBeNull();
    expect(split.body).toBe(content);
  });

  it('handles CRLF line endings and a BOM', () => {
    const split = splitFrontmatter('\uFEFF---\r\ntitle: CRLF\r\n---\r\nbody');
    expect(split.frontmatter).toBe('title: CRLF');
    expect(split.body).toBe('body');
  });

  it('supports an empty frontmatter block', () => {
    const split = splitFrontmatter('---\n---\nbody here');
    expect(split.frontmatter).toBe('');
    expect(split.body).toBe('body here');
  });
});

describe('parseFrontmatter', () => {
  it('parses scalars, lists, and nested maps', () => {
    const parsed = parseFrontmatter(
      'title: آزمایش\nstatus: draft\nconfidence: 0.8\ntags:\n  - a\n  - b\nmeta:\n  author: X',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value['title']).toBe('آزمایش');
      expect(parsed.value['status']).toBe('draft');
      expect(parsed.value['tags']).toEqual(['a', 'b']);
    }
  });

  it('returns issues for invalid YAML instead of throwing', () => {
    const parsed = parseFrontmatter('title: [unclosed');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.length).toBeGreaterThan(0);
      expect(parsed.error[0]!.message).toMatch(/Invalid YAML/);
    }
  });

  it('rejects non-mapping YAML documents', () => {
    expect(parseFrontmatter('- just\n- a\n- list').ok).toBe(false);
    expect(parseFrontmatter('plain string').ok).toBe(false);
  });

  it('treats empty frontmatter as an empty record', () => {
    const parsed = parseFrontmatter('');
    expect(parsed.ok && Object.keys(parsed.value)).toHaveLength(0);
  });

  it('preserves unknown properties verbatim', () => {
    const parsed = parseFrontmatter('custom-field: {deep: [1, 2, 3]}');
    expect(parsed.ok && JSON.stringify(parsed.value['custom-field'])).toBe(
      JSON.stringify({ deep: [1, 2, 3] }),
    );
  });
});

describe('readFrontmatter', () => {
  it('combines split and parse, always returning a body', () => {
    const result = readFrontmatter('---\ntitle: سلام\n---\n# متن');
    expect(result.data['title']).toBe('سلام');
    expect(result.body).toBe('# متن');
    expect(result.issues).toEqual([]);
  });

  it('surfaces YAML issues while keeping the body editable', () => {
    const result = readFrontmatter('---\nbad: [\n---\n# still editable');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.body).toBe('# still editable');
    expect(result.data).toEqual({});
  });
});
