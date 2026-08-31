import { describe, expect, it } from 'vitest';
import { extractOutgoingLinks, BacklinkIndex } from '../src/index.js';
import { buildStemMap, resolveWikiLink } from '../src/resolve.js';
import type { LinkReference } from '../src/index.js';

describe('extractOutgoingLinks', () => {
  it('returns wiki and markdown tokens separately', () => {
    const links = extractOutgoingLinks('[[One]] and [two](two.md) and `[[NotALink]]`');
    expect(links.wiki.map((token) => token.target)).toEqual(['One']);
    expect(links.markdown.map((token) => token.href)).toEqual(['two.md']);
  });
});

describe('BacklinkIndex', () => {
  const stems = buildStemMap(['a.md', 'b.md', 'c.md']);
  const paths = ['a.md', 'b.md', 'c.md'];

  function referencesFor(source: string, content: string): LinkReference[] {
    const links = extractOutgoingLinks(content);
    return links.wiki.flatMap((token) => {
      const resolution = resolveWikiLink(token, stems, paths);
      if (resolution.status !== 'resolved') {
        return [];
      }
      return [
        {
          source,
          target: resolution.vaultPath,
          display: token.alias ?? token.target,
          line: token.line,
          heading: token.heading,
          kind: 'wiki' as const,
        },
      ];
    });
  }

  it('accumulates backlinks and removes them when the source disappears', () => {
    const index = new BacklinkIndex();
    index.update('a.md', referencesFor('a.md', 'see [[b]] and [[c]]'), extractOutgoingLinks('see [[b]] and [[c]]'));
    index.update('b.md', referencesFor('b.md', 'back to [[a]]'), extractOutgoingLinks('back to [[a]]'));

    expect(index.backlinksOf('b.md').map((reference) => reference.source)).toEqual(['a.md']);
    expect(index.backlinksOf('a.md').map((reference) => reference.source)).toEqual(['b.md']);

    index.remove('a.md');
    expect(index.backlinksOf('b.md')).toEqual([]);
    expect(index.outgoingOf('a.md').wiki).toHaveLength(0);
  });

  it('replace-updates a note without duplicating references', () => {
    const index = new BacklinkIndex();
    index.update('a.md', referencesFor('a.md', '[[b]]'), extractOutgoingLinks('[[b]]'));
    index.update('a.md', referencesFor('a.md', '[[b]] [[b]]'), extractOutgoingLinks('[[b]] [[b]]'));
    expect(index.backlinksOf('b.md')).toHaveLength(2);
    expect(index.snapshotSize().outgoingEntries).toBe(1);
  });

  it('tracks unreferenced paths', () => {
    const index = new BacklinkIndex();
    index.update('a.md', referencesFor('a.md', '[[b]]'), extractOutgoingLinks('[[b]]'));
    index.update('c.md', referencesFor('c.md', 'no links'), extractOutgoingLinks('no links'));
    // a.md exists and is indexed but nothing links to it; c.md has no links.
    expect([...index.unreferencedPaths()].sort()).toEqual(['a.md', 'c.md']);
  });

  it('clear() resets everything', () => {
    const index = new BacklinkIndex();
    index.update('a.md', referencesFor('a.md', '[[b]]'), extractOutgoingLinks('[[b]]'));
    index.clear();
    expect(index.snapshotSize()).toEqual({ incomingEntries: 0, outgoingEntries: 0 });
    expect(index.backlinksOf('b.md')).toEqual([]);
  });
});
