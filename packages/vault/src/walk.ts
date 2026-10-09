import { err, getVaultExtension, isMarkdownPath, ok, type Result } from '@knowledge-studio/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { VaultError } from './errors.js';
import { IGNORED_DIRECTORY_NAMES } from './vault.js';

/**
 * Vault enumeration: one recursive walk classifying every entry as a note,
 * attachment, other file, or folder. Reserved directories (application dir,
 * `.git`) are never surfaced. The walk uses `lstat` so symlinks appear as
 * plain entries rather than being traversed into.
 */

export type VaultEntryKind = 'note' | 'attachment' | 'file' | 'folder';

export interface VaultEntry {
  readonly kind: VaultEntryKind;
  /** Canonical vault-relative path (forward slashes). */
  readonly path: string;
  /** Final path segment. */
  readonly name: string;
}

/** Extensions the walker classifies as attachments (mirror of the vault set). */
const ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'pdf',
  'txt',
  'csv',
  'json',
  'mdx',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'epub',
  'zip',
]);

export async function walkVault(root: string): Promise<Result<readonly VaultEntry[], VaultError>> {
  const entries: VaultEntry[] = [];
  const walk = async (absoluteDir: string, relativeDir: string): Promise<void> => {
    const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
    dirents.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    for (const dirent of dirents) {
      if (relativeDir === '' && IGNORED_DIRECTORY_NAMES.includes(dirent.name)) {
        continue;
      }
      // Atomic vault writes use a same-directory `.<name>.ks-tmp-<nonce>`
      // file. It is never user content and may be observable during a watch
      // refresh, so do not surface it in the explorer or indexes.
      if (dirent.isFile() && dirent.name.includes('.ks-tmp-')) {
        continue;
      }
      const vaultPath = relativeDir === '' ? dirent.name : `${relativeDir}/${dirent.name}`;
      const absolute = path.join(absoluteDir, dirent.name);
      if (dirent.isDirectory()) {
        entries.push({ kind: 'folder', path: vaultPath, name: dirent.name });
        await walk(absolute, vaultPath);
      } else if (dirent.isFile()) {
        entries.push({ kind: classifyFile(vaultPath), path: vaultPath, name: dirent.name });
      }
      // Symlinks and other specials are intentionally skipped: content
      // enumeration must never traverse outside the vault.
    }
  };
  try {
    await walk(root, '');
  } catch (error) {
    return err(new VaultError('VAULT_READ_FAILED', 'Cannot enumerate the vault', { cause: error }));
  }
  return ok(entries);
}

function classifyFile(vaultPath: string): VaultEntryKind {
  if (isMarkdownPath(vaultPath)) {
    return 'note';
  }
  const extension = getVaultExtension(vaultPath);
  return ATTACHMENT_EXTENSIONS.has(extension) ? 'attachment' : 'file';
}

/** Convenience filters over {@link walkVault} output. */
export function filterNotes(entries: readonly VaultEntry[]): readonly VaultEntry[] {
  return entries.filter((entry) => entry.kind === 'note');
}

export function filterAttachments(entries: readonly VaultEntry[]): readonly VaultEntry[] {
  return entries.filter((entry) => entry.kind === 'attachment');
}

export function filterFolders(entries: readonly VaultEntry[]): readonly VaultEntry[] {
  return entries.filter((entry) => entry.kind === 'folder');
}
