import { describe, expect, it } from 'vitest';
import { extractMarkdownLinks, extractWikiLinks, stripCodeSpans } from '../src/index.js';

describe('extractWikiLinks', () => {
  it('parses all four syntax forms', () => {
    const content = [
      'plain [[Note]] here',
      'alias [[Note|friendly name]]',
      'heading [[Note#Section]]',
      'both [[Note#Section|alias]]',
    ].join('\n');
    const tokens = extractWikiLinks(content);
    expect(tokens).toHaveLength(4);
    const [plain, alias, heading, both] = tokens;
    expect(plain).toMatchObject({ target: 'Note', heading: null, alias: null, line: 1 });
    expect(alias).toMatchObject({ target: 'Note', alias: 'friendly name', line: 2 });
    expect(heading).toMatchObject({ target: 'Note', heading: 'Section', line: 3 });
    expect(both).toMatchObject({ target: 'Note', heading: 'Section', alias: 'alias', line: 4 });
  });

  it('records accurate offsets and line numbers', () => {
    const content = 'first\nsecond [[Target#H|A]] third';
    const tokens = extractWikiLinks(content);
    const token = tokens[0]!;
    expect(token.line).toBe(2);
    expect(content.slice(token.start, token.end)).toBe('[[Target#H|A]]');
  });

  it('supports Persian targets and aliases', () => {
    const tokens = extractWikiLinks('[[یادداشت پروژه|پروژه]]');
    expect(tokens[0]).toMatchObject({ target: 'یادداشت پروژه', alias: 'پروژه' });
  });

  it('ignores code spans and fenced blocks', () => {
    const content = [
      'real [[Real]] link',
      '`inline [[Fake]] code`',
      '```md',
      '[[Fenced]]',
      '```',
    ].join('\n');
    const stripped = stripCodeSpans(content);
    const tokens = extractWikiLinks(stripped);
    expect(tokens.map((token) => token.target)).toEqual(['Real']);
  });

  it('ignores single brackets and unclosed syntax', () => {
    const tokens = extractWikiLinks('not [linked] and [[unclosed');
    expect(tokens).toHaveLength(0);
  });
});

describe('extractMarkdownLinks', () => {
  it('parses relative and absolute URLs', () => {
    const tokens = extractMarkdownLinks(
      'see [docs](docs/intro.md) and [site](https://example.com)',
    );
    expect(tokens.map((token) => token.href)).toEqual(['docs/intro.md', 'https://example.com']);
  });

  it('skips data: and mailto: URLs', () => {
    const tokens = extractMarkdownLinks('[a](mailto:x@y.z) [b](data:text/html,hi)');
    expect(tokens).toHaveLength(0);
  });

  it('ignores images and code', () => {
    const content = '![img](logo.png)\n`[not](a-link)`\n```\n[x](y)\n```';
    const tokens = extractMarkdownLinks(stripCodeSpans(content));
    expect(tokens).toHaveLength(0);
  });

  it('reports line numbers', () => {
    const tokens = extractMarkdownLinks('one\n\ntwo [link](target.md)');
    expect(tokens[0]?.line).toBe(3);
  });
});
