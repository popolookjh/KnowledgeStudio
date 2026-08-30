import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VaultPathError } from '@knowledge-studio/shared';
import {
  APP_DIR_NAME,
  createVault,
  openVault,
  VaultError,
} from '../src/index.js';
import type { Vault } from '../src/index.js';

let vault: Vault;
let vaultRoot: string;

beforeAll(async () => {
  vaultRoot = mkdtempSync(path.join(tmpdir(), 'ks-vault-'));
  const created = await createVault(vaultRoot);
  if (!created.ok) {
    throw new Error(`failed to create test vault: ${String(created.error)}`);
  }
  vault = created.value;
});

afterAll(() => {
  vault.close();
  rmSync(vaultRoot, { recursive: true, force: true });
});

function expectVaultError(
  result: { ok: boolean; error?: unknown },
  code: string,
): void {
  expect(result.ok).toBe(false);
  const error = result.ok ? undefined : result.error;
  expect(error).toBeInstanceOf(VaultError);
  expect((error as VaultError).code).toBe(code);
}

describe('vault lifecycle', () => {
  it('creates the application directory inside the vault', () => {
    expect(vault.appDir).toBe(path.join(vault.root, APP_DIR_NAME));
  });

  it('refuses to create a vault over unrelated content', async () => {
    const occupied = mkdtempSync(path.join(tmpdir(), 'ks-occupied-'));
    writeFileSync(path.join(occupied, 'precious.md'), '# do not touch');
    const result = await createVault(occupied);
    expectVaultError(result, 'VAULT_ROOT_NOT_EMPTY_FILE_CONFLICT');
    rmSync(occupied, { recursive: true, force: true });
  });

  it('opens an existing folder of markdown as a vault (import path)', async () => {
    const existing = mkdtempSync(path.join(tmpdir(), 'ks-existing-'));
    writeFileSync(path.join(existing, 'existing-note.md'), 'already here');
    const opened = await openVault(existing);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      const read = await opened.value.readFile('existing-note.md');
      expect(read.ok && read.value.content).toBe('already here');
      opened.value.close();
    }
    rmSync(existing, { recursive: true, force: true });
  });

  it('rejects a root that does not exist', async () => {
    const result = await openVault(path.join(tmpdir(), 'ks-does-not-exist-xyz'));
    expectVaultError(result, 'VAULT_ROOT_INVALID');
  });

  it('rejects a file as vault root', async () => {
    const filePath = path.join(tmpdir(), `ks-file-${Date.now()}.txt`);
    writeFileSync(filePath, 'not a directory');
    const result = await openVault(filePath);
    expectVaultError(result, 'VAULT_ROOT_INVALID');
  });
});

describe('path traversal and containment', () => {
  it('rejects parent traversal on every operation', async () => {
    for (const escape of ['../escape.md', 'notes/../../escape.md', '..']) {
      const write = await vault.writeFile(escape, 'nope');
      expect(write.ok, escape).toBe(false);
      const read = await vault.readFile(escape);
      expect(read.ok, escape).toBe(false);
    }
  });

  it('rejects traversal with a precise VaultPathError reason', async () => {
    const result = await vault.readFile('../secrets.md');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(VaultPathError);
      expect((result.error as VaultPathError).reason).toBe('traversal');
    }
  });

  it('rejects absolute paths, drive letters, and backslashes', async () => {
    for (const bad of ['/etc/passwd', 'C:/Windows/system32', 'folder\\note.md']) {
      const result = await vault.writeFile(bad, 'x');
      expect(result.ok, bad).toBe(false);
    }
  });

  it('blocks access to the application directory', async () => {
    expectVaultError(await vault.readFile(`${APP_DIR_NAME}/index.db`), 'VAULT_ESCAPE_BLOCKED');
    expectVaultError(
      await vault.writeFile(`${APP_DIR_NAME}/evil.md`, 'x'),
      'VAULT_ESCAPE_BLOCKED',
    );
    expectVaultError(await vault.rename('real.md', `${APP_DIR_NAME}/stolen.md`), 'VAULT_ESCAPE_BLOCKED');
  });

  it('blocks symlink escape out of the vault root', async () => {
    const outside = mkdtempSync(path.join(tmpdir(), 'ks-outside-'));
    const outsideFile = path.join(outside, 'target.md');
    writeFileSync(outsideFile, 'outside content');
    let linkCreated = true;
    try {
      symlinkSync(outsideFile, path.join(vault.root, 'sneaky-link.md'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        linkCreated = false; // Windows without developer mode: cannot probe
      } else {
        throw error;
      }
    }
    if (linkCreated) {
      expectVaultError(await vault.readFile('sneaky-link.md'), 'VAULT_ESCAPE_BLOCKED');
      expectVaultError(
        await vault.writeFile('sneaky-link.md', 'hijack'),
        'VAULT_ESCAPE_BLOCKED',
      );
    }
    rmSync(outside, { recursive: true, force: true });
  });
});

describe('atomic text IO', () => {
  it('writes and reads back content, creating parent folders', async () => {
    const write = await vault.writeFile('notes/projects/idea.md', '# ایده\nسلام دنیا');
    expect(write.ok).toBe(true);
    const read = await vault.readFile('notes/projects/idea.md');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.content).toBe('# ایده\nسلام دنیا');
      expect(read.value.size).toBeGreaterThan(0);
    }
  });

  it('leaves no temp files behind after writes', async () => {
    await vault.writeFile('notes/clean.md', 'v1');
    await vault.writeFile('notes/clean.md', 'v2');
    const listing = await import('node:fs/promises').then((m) =>
      m.readdir(path.join(vault.root, 'notes')),
    );
    expect(listing).toEqual(['clean.md', 'projects']);
  });

  it('overwrites existing content atomically on rewrite', async () => {
    await vault.writeFile('notes/rewrite.md', 'first version');
    await vault.writeFile('notes/rewrite.md', 'second version');
    const read = await vault.readFile('notes/rewrite.md');
    expect(read.ok && read.value.content).toBe('second version');
  });

  it('reports missing files as VAULT_PATH_NOT_FOUND', async () => {
    expectVaultError(await vault.readFile('notes/never-created.md'), 'VAULT_PATH_NOT_FOUND');
  });

  it('supports Persian filenames end to end', async () => {
    const persian = 'یادداشت‌ها/پروژه الف/یادداشت ۱.md';
    const write = await vault.writeFile(persian, '# یادداشت فارسی');
    expect(write.ok).toBe(true);
    const read = await vault.readFile(persian);
    expect(read.ok && read.value.content).toBe('# یادداشت فارسی');
    const exists = await vault.exists(persian);
    expect(exists.ok && exists.value).toBe(true);
  });

  it('exists() answers false for missing, true for present', async () => {
    const missing = await vault.exists('notes/definitely-not-here.md');
    expect(missing.ok && missing.value).toBe(false);
    const present = await vault.exists('notes/clean.md');
    expect(present.ok && present.value).toBe(true);
  });
});

describe('external edit detection', () => {
  it('refuses writes based on a stale mtime (external modification)', async () => {
    await vault.writeFile('notes/conflict.md', 'editor content');
    const firstRead = await vault.readFile('notes/conflict.md');
    if (!firstRead.ok) {
      throw new Error('setup read failed');
    }
    // External edit happens between read and save.
    const fs = await import('node:fs/promises');
    await fs.writeFile(path.join(vault.root, 'notes', 'conflict.md'), 'external edit');
    const staleSave = await vault.writeFile('notes/conflict.md', 'editor overwrite', {
      expectedMtimeMs: firstRead.value.mtimeMs,
    });
    expectVaultError(staleSave, 'VAULT_MODIFIED_SINCE_READ');
    // The external content survives the refused save.
    const after = await vault.readFile('notes/conflict.md');
    expect(after.ok && after.value.content).toBe('external edit');
  });

  it('accepts saves when the mtime matches the read', async () => {
    await vault.writeFile('notes/fresh.md', 'base');
    const read = await vault.readFile('notes/fresh.md');
    if (!read.ok) {
      throw new Error('setup read failed');
    }
    const save = await vault.writeFile('notes/fresh.md', 'editor version', {
      expectedMtimeMs: read.value.mtimeMs,
    });
    expect(save.ok).toBe(true);
  });
});

describe('rename', () => {
  it('moves a file and refuses to overwrite an existing target', async () => {
    await vault.writeFile('notes/rename-a.md', 'alpha');
    const renamed = await vault.rename('notes/rename-a.md', 'notes/renamed/b.md');
    expect(renamed.ok).toBe(true);
    const moved = await vault.readFile('notes/renamed/b.md');
    expect(moved.ok && moved.value.content).toBe('alpha');
    const original = await vault.exists('notes/rename-a.md');
    expect(original.ok && original.value).toBe(false);

    await vault.writeFile('notes/occupied.md', 'occupied');
    const clash = await vault.rename('notes/renamed/b.md', 'notes/occupied.md');
    expectVaultError(clash, 'VAULT_PATH_EXISTS');
    // The source must be untouched after a refused rename.
    const survivor = await vault.readFile('notes/renamed/b.md');
    expect(survivor.ok && survivor.value.content).toBe('alpha');
  });
});

describe('trash and restore', () => {
  it('deletes to trash, lists, and restores intact', async () => {
    await vault.writeFile('notes/doomed.md', 'important content');
    const trashed = await vault.deleteToTrash('notes/doomed.md');
    expect(trashed.ok).toBe(true);
    const gone = await vault.exists('notes/doomed.md');
    expect(gone.ok && gone.value).toBe(false);

    const list = await vault.listTrash();
    expect(list.ok).toBe(true);
    const entry = list.ok ? list.value.find((e) => e.originalPath === 'notes/doomed.md') : undefined;
    expect(entry).toBeDefined();

    if (trashed.ok) {
      const restored = await vault.restoreFromTrash(trashed.value.id);
      expect(restored.ok).toBe(true);
      const back = await vault.readFile('notes/doomed.md');
      expect(back.ok && back.value.content).toBe('important content');
    }
  });

  it('never destroys content: trashed file bytes are preserved on disk', async () => {
    await vault.writeFile('notes/kept.md', 'safe bytes');
    const trashed = await vault.deleteToTrash('notes/kept.md');
    expect(trashed.ok).toBe(true);
    if (!trashed.ok) {
      return;
    }
    const fs = await import('node:fs/promises');
    const contentPath = path.join(vault.appDir, 'trash', trashed.value.id, 'content');
    const raw = await fs.readFile(contentPath, 'utf8');
    expect(raw).toBe('safe bytes');
    await vault.restoreFromTrash(trashed.value.id);
  });

  it('refuses restore when the original path is occupied again', async () => {
    await vault.writeFile('notes/roundtrip.md', 'old version');
    const trashed = await vault.deleteToTrash('notes/roundtrip.md');
    if (!trashed.ok) {
      throw new Error('trash setup failed');
    }
    await vault.writeFile('notes/roundtrip.md', 'brand new note');
    const restore = await vault.restoreFromTrash(trashed.value.id);
    expectVaultError(restore, 'VAULT_RESTORE_CONFLICT');
    // New content intact; trash entry retained for manual resolution.
    const current = await vault.readFile('notes/roundtrip.md');
    expect(current.ok && current.value.content).toBe('brand new note');
    const list = await vault.listTrash();
    expect(list.ok && list.value.some((e) => e.id === trashed.value.id)).toBe(true);
  });

  it('rejects unknown trash entry ids', async () => {
    expectVaultError(
      await vault.restoreFromTrash('00000000-0000-4000-8000-000000000000'),
      'VAULT_TRASH_ENTRY_NOT_FOUND',
    );
    expectVaultError(await vault.restoreFromTrash('not-a-uuid'), 'VAULT_TRASH_ENTRY_NOT_FOUND');
  });
});

describe('binary attachments', () => {
  it('reads binary attachments byte-for-byte', async () => {
    const fs = await import('node:fs/promises');
    const pngBytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80,
    ]);
    await fs.mkdir(path.join(vault.root, 'attachments'), { recursive: true });
    await fs.writeFile(path.join(vault.root, 'attachments', 'diagram.png'), pngBytes);
    const read = await vault.readBinary('attachments/diagram.png');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect([...read.value.bytes]).toEqual([...pngBytes]);
      expect(read.value.size).toBe(pngBytes.length);
    }
  });

  it('isAttachmentPath recognizes known attachment extensions', async () => {
    const { isAttachmentPath } = await import('../src/index.js');
    expect(isAttachmentPath('a/b.png')).toBe(true);
    expect(isAttachmentPath('a/b.PDF')).toBe(true);
    expect(isAttachmentPath('my.folder/note')).toBe(false);
    expect(isAttachmentPath('note.md')).toBe(false);
    expect(isAttachmentPath('archive.tar.gz')).toBe(false);
  });
});
