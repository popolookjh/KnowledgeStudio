import { describe, expect, it } from 'vitest';
import { chunkMarkdown, scoreChunks, tokenize } from '../src/index.js';

describe('retrieval', () => {
  const note =
    '---\ntitle: T\n---\nIntro text.\n\n# Methods\nWe measured قطر درختان carefully.\n\n```\n# not a heading\n```\n## Results\nمیانگین قطر ۴۲ بود.\n';
  it('chunks by heading, skips frontmatter and fenced pseudo-headings', () => {
    const chunks = chunkMarkdown(note);
    expect(chunks.map((chunk) => chunk.heading)).toEqual([null, 'Methods', 'Results']);
    expect(chunks[1]!.text).toContain('# not a heading');
    expect(chunks.some((chunk) => chunk.text.includes('title: T'))).toBe(false);
  });
  it('splits oversized sections', () => {
    const chunks = chunkMarkdown(`# Big\n${'word '.repeat(700)}`);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.text.length <= 1200 && chunk.heading === 'Big')).toBe(
      true,
    );
  });
  it('tokenizes Persian with ZWNJ and diacritics consistently', () => {
    expect(tokenize('کتاب‌ها Research!')).toEqual(['کتابها', 'research']);
  });
  it('ranks heading and term matches deterministically', () => {
    const ranked = scoreChunks(chunkMarkdown(note), 'قطر results');
    expect(ranked[0]!.heading).toBe('Results');
    expect(ranked.map((chunk) => chunk.heading)).toEqual(['Results', 'Methods']);
    expect(scoreChunks(chunkMarkdown(note), '!!!')).toEqual([]);
  });
});
