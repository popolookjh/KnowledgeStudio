import { describe, expect, it } from 'vitest';
import { extractWikiLinks } from '../src/parse.js';
import { buildStemMap, resolveWikiLink, targetPathForUnresolved } from '../src/resolve.js';

function token(target: string, heading: string | null = null) {
  const tokens = extractWikiLinks(`[[${target}${heading ? `#${heading}` : ''}]]`);
  return tokens[0]!;
}

describe('buildStemMap', () => {
  it('indexes stems case-insensitively across folders', () => {
    const map = buildStemMap(['notes/Alpha.md', 'deep/folder/alpha.md', 'other/Beta.MD']);
    expect(map.get('alpha')).toEqual(['notes/Alpha.md', 'deep/folder/alpha.md']);
    expect(map.get('beta')).toEqual(['other/Beta.MD']);
  });
});

describe('resolveWikiLink', () => {
  const stems = buildStemMap(['notes/alpha.md', 'projects/alpha.md', 'beta.md']);
  const paths = ['notes/alpha.md', 'projects/alpha.md', 'beta.md'];

  it('resolves a unique stem regardless of folder', () => {
    const resolution = resolveWikiLink(token('beta'), stems, paths);
    expect(resolution).toEqual({ status: 'resolved', vaultPath: 'beta.md', heading: null });
  });

  it('reports ambiguous when several notes share the stem', () => {
    const resolution = resolveWikiLink(token('Alpha'), stems, paths);
    expect(resolution.status).toBe('ambiguous');
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toEqual(['notes/alpha.md', 'projects/alpha.md']);
    }
  });

  it('reports unresolved for unknown targets, keeping the heading', () => {
    const resolution = resolveWikiLink(token('Missing', 'Section'), stems, paths);
    expect(resolution).toEqual({ status: 'unresolved', target: 'Missing', heading: 'Section' });
  });

  it('resolves case-insensitively', () => {
    const resolution = resolveWikiLink(token('BETA'), stems, paths);
    expect(resolution.status).toBe('resolved');
  });

  it('resolves folder-hinted targets by exact path', () => {
    const resolution = resolveWikiLink(token('projects/alpha'), stems, paths);
    expect(resolution).toEqual({
      status: 'resolved',
      vaultPath: 'projects/alpha.md',
      heading: null,
    });
  });

  it('exact path match wins over stem ambiguity', () => {
    const resolution = resolveWikiLink(token('notes/alpha.md'), stems, paths);
    expect(resolution.status).toBe('resolved');
  });
});

describe('targetPathForUnresolved', () => {
  it('appends the .md extension', () => {
    const result = targetPathForUnresolved('New Note', null);
    expect(result.ok && result.value).toBe('New Note.md');
  });

  it('keeps explicit extensions', () => {
    const result = targetPathForUnresolved('folder/note.md', null);
    expect(result.ok && result.value).toBe('folder/note.md');
  });

  it('rejects traversal targets', () => {
    const result = targetPathForUnresolved('../escape', null);
    expect(result.ok).toBe(false);
  });
});
