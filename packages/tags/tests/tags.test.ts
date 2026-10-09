import { describe, expect, it } from 'vitest';
import { extractTags, TagIndex } from '../src/index.js';

describe('extractTags', () => {
  it('extracts inline and nested tags', () => {
    const tags = extractTags('Work on #project/alpha and #idea today.');
    expect(tags.map((tag) => tag.tag)).toEqual(['project/alpha', 'idea']);
  });
  it('supports Persian tags', () => {
    expect(extractTags('این یک #یادداشت/فارسی است').map((tag) => tag.tag)).toEqual([
      'یادداشت/فارسی',
    ]);
  });
  it('merges frontmatter tags before inline tags', () => {
    const tags = extractTags('---\ntags: [Core, design]\n---\n#design #inline');
    expect(tags.map((tag) => tag.tag)).toEqual(['core', 'design', 'inline']);
  });
  it('does not mistake headings, inline code, or fenced code for tags', () => {
    const tags = extractTags('# Heading\n`#code`\n```\n#fenced\n```\nreal #yes');
    expect(tags.map((tag) => tag.tag)).toEqual(['yes']);
  });
  it('deduplicates tags and reports line numbers', () => {
    const tags = extractTags('one #same\ntwo #same\nthree #other');
    expect(tags).toEqual([
      { tag: 'same', line: 1, source: 'inline' },
      { tag: 'other', line: 3, source: 'inline' },
    ]);
  });
});

describe('TagIndex', () => {
  it('incrementally updates, counts, filters and removes paths', () => {
    const index = new TagIndex();
    index.update('a.md', extractTags('#alpha #shared'));
    index.update('b.md', extractTags('#beta #shared'));
    expect(index.tags()).toEqual([
      { tag: 'alpha', count: 1 },
      { tag: 'beta', count: 1 },
      { tag: 'shared', count: 2 },
    ]);
    expect(index.pathsFor('#shared')).toEqual(['a.md', 'b.md']);
    index.update('a.md', extractTags('#changed'));
    expect(index.pathsFor('shared')).toEqual(['b.md']);
    index.remove('b.md');
    expect(index.tags()).toEqual([{ tag: 'changed', count: 1 }]);
  });
});
