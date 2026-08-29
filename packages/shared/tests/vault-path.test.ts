import { describe, expect, it } from 'vitest';
import {
  getVaultBasename,
  getVaultDirname,
  getVaultExtension,
  getVaultStem,
  isMarkdownPath,
  isOk,
  joinVaultPath,
  MAX_VAULT_PATH_LENGTH,
  MAX_VAULT_SEGMENT_LENGTH,
  normalizeVaultPath,
  VaultPathError,
} from '../src/index.js';

function expectOkPath(raw: string, canonical: string): void {
  const result = normalizeVaultPath(raw);
  if (!isOk(result)) {
    throw new Error(`expected '${raw}' to be valid, got ${String(result.error)}`);
  }
  expect(result.value).toBe(canonical);
}

function expectReason(raw: string, reason: VaultPathError['reason']): void {
  const result = normalizeVaultPath(raw);
  expect(result.ok, `'${raw}' should be invalid`).toBe(false);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(VaultPathError);
    expect(result.error.reason, `'${raw}'`).toBe(reason);
  }
}

describe('normalizeVaultPath — accepted inputs', () => {
  it('accepts simple relative paths unchanged', () => {
    expectOkPath('notes/idea.md', 'notes/idea.md');
    expectOkPath('readme.md', 'readme.md');
  });

  it('accepts Persian and mixed-script paths', () => {
    expectOkPath('یادداشت‌ها/سلام دنیا.md', 'یادداشت‌ها/سلام دنیا.md');
    expectOkPath('پروژه‌ها/Alpha/یادداشت ۲.md', 'پروژه‌ها/Alpha/یادداشت ۲.md');
  });

  it('collapses duplicate slashes', () => {
    expectOkPath('a//b///c.md', 'a/b/c.md');
  });

  it('drops . segments and trailing slashes', () => {
    expectOkPath('./a/b.md', 'a/b.md');
    expectOkPath('a/./b.md', 'a/b.md');
    expectOkPath('a/b/', 'a/b');
  });

  it('accepts dots and spaces inside names', () => {
    expectOkPath('v1.2 notes/meeting.notes.md', 'v1.2 notes/meeting.notes.md');
  });
});

describe('normalizeVaultPath — rejected inputs', () => {
  it('rejects empty and root-only inputs', () => {
    expectReason('', 'empty');
    expectReason('.', 'empty');
    expectReason('./', 'empty');
    expectReason('/', 'absolute');
  });

  it('rejects parent traversal anywhere in the path', () => {
    expectReason('..', 'traversal');
    expectReason('../secrets.md', 'traversal');
    expectReason('a/../b.md', 'traversal');
    expectReason('a/b/../../../c.md', 'traversal');
  });

  it('rejects absolute paths', () => {
    expectReason('/etc/passwd', 'absolute');
  });

  it('rejects drive letters in any casing or position', () => {
    expectReason('C:/Users/x.md', 'drive-letter');
    expectReason('c:/x', 'drive-letter');
    expectReason('a/C:/x.md', 'drive-letter');
  });

  it('rejects UNC paths', () => {
    expectReason('//server/share/x.md', 'unc');
  });

  it('rejects backslashes outright', () => {
    expectReason('a\\b.md', 'invalid-separator');
    expectReason('\\\\server\\share', 'invalid-separator');
  });

  it('rejects NUL and control characters', () => {
    expectReason('a\u0000b.md', 'invalid-character');
    expectReason('a\u001fb.md', 'invalid-character');
    expectReason('a\u009fb.md', 'invalid-character');
  });

  it('rejects Windows-forbidden characters', () => {
    for (const ch of ['<', '>', ':', '"', '|', '?', '*']) {
      expectReason(`a${ch}b.md`, 'invalid-character');
    }
  });

  it('rejects reserved Windows device names case-insensitively', () => {
    for (const name of ['con', 'PRN', 'Aux', 'nul', 'Com1', 'COM9', 'lpt1', 'LPT7']) {
      expectReason(`notes/${name}.md`, 'reserved-name');
      expectReason(name, 'reserved-name');
      // The reservation applies to the portion before the first dot.
      expectReason(`notes/${name}.backup.md`, 'reserved-name');
    }
  });

  it('allows names that merely look like reserved names', () => {
    expectOkPath('notes/com10.md', 'notes/com10.md');
    expectOkPath('notes/lpt12.md', 'notes/lpt12.md');
    expectOkPath('notes/conan.md', 'notes/conan.md');
    expectOkPath('notes/nullify.md', 'notes/nullify.md');
    // Hidden files keep their full name as the reserved-stem check skips
    // leading-dot names (``.gitignore`` stem is ``.gitignore``).
    expectOkPath('.gitignore', '.gitignore');
  });

  it('rejects trailing dots or spaces in segments', () => {
    expectReason('note.', 'trailing-dot-or-space');
    expectReason('note ', 'trailing-dot-or-space');
    expectReason('a/b.', 'trailing-dot-or-space');
  });

  it('rejects oversized segments and paths', () => {
    expectReason('a'.repeat(MAX_VAULT_SEGMENT_LENGTH + 1), 'segment-too-long');
    // A path built from many valid segments that exceeds the total cap.
    const longPath = Array.from({ length: 20 }, () => 'x'.repeat(60)).join('/');
    expect(longPath.length).toBeGreaterThan(MAX_VAULT_PATH_LENGTH);
    expectReason(longPath, 'path-too-long');
  });
});

describe('joinVaultPath', () => {
  it('joins a base with parts', () => {
    expect(joinVaultPath('notes', 'idea.md')).toEqual({ ok: true, value: 'notes/idea.md' });
    expect(joinVaultPath('notes', 'sub', 'idea.md')).toEqual({
      ok: true,
      value: 'notes/sub/idea.md',
    });
  });

  it('treats an empty base as the vault root', () => {
    expect(joinVaultPath('', 'a/b.md')).toEqual({ ok: true, value: 'a/b.md' });
  });

  it('validates every part, so traversal cannot slip in', () => {
    expect(joinVaultPath('notes', '..', 'escape.md').ok).toBe(false);
    expect(joinVaultPath('notes', '/abs.md').ok).toBe(false);
    expect(joinVaultPath('', 'C:/x.md').ok).toBe(false);
    expect(joinVaultPath('..', 'x.md').ok).toBe(false);
  });

  it('rejects results that exceed the total length cap', () => {
    const long = 'x'.repeat(MAX_VAULT_PATH_LENGTH);
    expect(joinVaultPath(long, 'tail.md').ok).toBe(false);
  });
});

describe('path accessors', () => {
  it('splits basename, dirname, stem and extension', () => {
    expect(getVaultBasename('notes/فارسی/یادداشت.md')).toBe('یادداشت.md');
    expect(getVaultDirname('notes/فارسی/یادداشت.md')).toBe('notes/فارسی');
    expect(getVaultDirname('idea.md')).toBe('');
    expect(getVaultStem('notes/idea.md')).toBe('idea');
    expect(getVaultExtension('notes/idea.md')).toBe('md');
  });

  it('lowercases extensions', () => {
    expect(getVaultExtension('a.MD')).toBe('md');
  });

  it('takes the last extension only', () => {
    expect(getVaultExtension('archive.tar.gz')).toBe('gz');
    expect(getVaultStem('archive.tar.gz')).toBe('archive.tar');
  });

  it('treats leading-dot names as hidden files without extensions', () => {
    expect(getVaultExtension('.gitignore')).toBe('');
    expect(getVaultStem('.gitignore')).toBe('.gitignore');
  });

  it('classifies Markdown paths case-insensitively', () => {
    expect(isMarkdownPath('a.md')).toBe(true);
    expect(isMarkdownPath('a.MD')).toBe(true);
    expect(isMarkdownPath('a.markdown')).toBe(false);
    expect(isMarkdownPath('a.txt')).toBe(false);
    expect(isMarkdownPath('a')).toBe(false);
  });
});
