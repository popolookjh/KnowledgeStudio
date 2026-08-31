import { describe, expect, it } from 'vitest';
import { extractOutline, slugify } from '../src/index.js';

describe('extractOutline', () => {
  it('extracts heading levels, text, and positions', () => {
    const outline = extractOutline('# Title\n\n## Section\n\ntext\n\n### Deep\n');
    expect(outline).toHaveLength(3);
    const [h1, h2, h3] = outline;
    expect(h1).toMatchObject({ level: 1, text: 'Title', line: 1 });
    expect(h2).toMatchObject({ level: 2, text: 'Section', line: 3 });
    expect(h3).toMatchObject({ level: 3, text: 'Deep', line: 7 });
  });

  it('flattens inline markup in heading text', () => {
    const outline = extractOutline('## **bold** and *italic* and `code`');
    expect(outline[0]?.text).toBe('bold and italic and code');
  });

  it('supports Persian headings', () => {
    const outline = extractOutline('# معرفی\n## بخش اول: معماری');
    expect(outline[0]?.text).toBe('معرفی');
    expect(outline[1]?.text).toBe('بخش اول: معماری');
    expect(outline[1]?.slug.length).toBeGreaterThan(0);
  });

  it('deduplicates identical heading slugs', () => {
    const outline = extractOutline('# Notes\n## Notes\n## Notes');
    const slugs = outline.map((entry) => entry.slug);
    expect(new Set(slugs).size).toBe(3);
    expect(slugs[0]).toBe('notes');
    expect(slugs[1]).toBe('notes-2');
    expect(slugs[2]).toBe('notes-3');
  });

  it('ignores headings inside fenced code blocks', () => {
    const outline = extractOutline('text\n\n```md\n# not a heading\n```\n\n# real');
    expect(outline).toHaveLength(1);
    expect(outline[0]?.text).toBe('real');
  });

  it('ignores setext headings inside blockquotes only', () => {
    const outline = extractOutline('> quoted\n\nSetext\n------\n');
    expect(outline.map((e) => e.level)).toEqual([2]);
    expect(outline[0]?.text).toBe('Setext');
  });

  it('returns an empty outline for content without headings', () => {
    expect(extractOutline('just text\nand more text')).toEqual([]);
  });
});

describe('slugify', () => {
  it('produces GitHub-style slugs', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  spaced   out  ')).toBe('spaced-out');
  });

  it('strips accents via NFKD', () => {
    expect(slugify('café')).toBe('cafe');
  });

  it('keeps Persian letters and digits', () => {
    expect(slugify('بخش اول: معماری')).toBe('بخش-اول-معماری');
    expect(slugify('یادداشت ۲')).toBe('یادداشت-۲');
  });

  it('falls back to a non-empty slug', () => {
    expect(slugify('???')).toBe('');
  });
});
