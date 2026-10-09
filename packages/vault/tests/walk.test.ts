import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { walkVault, filterAttachments, filterFolders, filterNotes } from '../src/index.js';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ks-walk-'));
  mkdirSync(path.join(root, 'notes', 'sub'), { recursive: true });
  writeFileSync(path.join(root, 'notes', 'alpha.md'), 'a');
  writeFileSync(path.join(root, 'notes', 'sub', 'beta.md'), 'b');
  writeFileSync(path.join(root, 'readme.md'), 'r');
  mkdirSync(path.join(root, 'assets'), { recursive: true });
  writeFileSync(path.join(root, 'assets', 'logo.png'), 'png');
  writeFileSync(path.join(root, 'assets', 'report.pdf'), 'pdf');
  writeFileSync(path.join(root, 'unknown.exe'), 'exe');
  mkdirSync(path.join(root, '.git'), { recursive: true });
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref');
  mkdirSync(path.join(root, '.knowledge-studio'));
  writeFileSync(path.join(root, '.knowledge-studio', 'index.db'), 'db');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('walkVault', () => {
  it('classifies notes, attachments, folders, and other files', async () => {
    const result = await walkVault(root);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const paths = result.value.map((entry) => `${entry.kind}:${entry.path}`);
    expect(paths).toContain('folder:notes');
    expect(paths).toContain('folder:notes/sub');
    expect(paths).toContain('note:notes/alpha.md');
    expect(paths).toContain('note:notes/sub/beta.md');
    expect(paths).toContain('note:readme.md');
    expect(paths).toContain('attachment:assets/logo.png');
    expect(paths).toContain('attachment:assets/report.pdf');
    expect(paths).toContain('file:unknown.exe');
  });

  it('never surfaces the application dir or .git', async () => {
    const result = await walkVault(root);
    if (!result.ok) {
      throw new Error('walk failed');
    }
    const paths = result.value.map((entry) => entry.path);
    expect(paths.some((p) => p.startsWith('.knowledge-studio'))).toBe(false);
    expect(paths.some((p) => p === '.git' || p.startsWith('.git/'))).toBe(false);
  });

  it('sorts entries naturally for stable listing', async () => {
    const result = await walkVault(root);
    if (!result.ok) {
      throw new Error('walk failed');
    }
    const paths = result.value.map((entry) => entry.path);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    expect(paths).toEqual(sorted);
  });

  it('filters notes, attachments, and folders', async () => {
    const result = await walkVault(root);
    if (!result.ok) {
      throw new Error('walk failed');
    }
    expect(filterNotes(result.value).every((entry) => entry.kind === 'note')).toBe(true);
    expect(filterAttachments(result.value).every((entry) => entry.kind === 'attachment')).toBe(
      true,
    );
    expect(filterFolders(result.value).every((entry) => entry.kind === 'folder')).toBe(true);
    expect(filterNotes(result.value).length).toBe(3);
    expect(filterAttachments(result.value).length).toBe(2);
  });

  it('never surfaces atomic vault temporary files', async () => {
    writeFileSync(path.join(root, 'notes', '.alpha.md.ks-tmp-deadbeef'), 'partial');
    const result = await walkVault(root);
    if (!result.ok) throw new Error('walk failed');
    expect(result.value.map((entry) => entry.path)).not.toContain(
      'notes/.alpha.md.ks-tmp-deadbeef',
    );
  });

  it('skips symlinks instead of traversing them', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'ks-walk-out-'));
    mkdirSync(path.join(outside, 'secret-sub'));
    writeFileSync(path.join(outside, 'secret-sub', 'secret.md'), 'x');
    let linkCreated = true;
    try {
      symlinkSync(outside, path.join(root, 'outside-link'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        linkCreated = false; // Windows without developer mode
      } else {
        throw error;
      }
    }
    if (linkCreated) {
      const result = await walkVault(root);
      if (!result.ok) {
        throw new Error('walk failed');
      }
      const paths = result.value.map((entry) => entry.path);
      expect(paths).not.toContain('outside-link');
      expect(paths.some((p) => p.includes('secret'))).toBe(false);
    }
    rmSync(outside, { recursive: true, force: true });
  });
});
