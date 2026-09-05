import {
  createId,
  createVaultId,
  err,
  getVaultExtension,
  normalizeVaultPath,
  ok,
  type Result,
  type VaultPathError,
} from '@knowledge-studio/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import { VaultError } from './errors.js';
import { atomicWriteFile, isInside, movePath, resolveInsideRoot } from './fs-safety.js';

/** Reserved application directory inside every vault (index, trash, logs). */
export const APP_DIR_NAME = '.knowledge-studio';

/** Directory names never surfaced as vault content. */
export const IGNORED_DIRECTORY_NAMES: readonly string[] = [APP_DIR_NAME, '.git'];

/** Union of every failure a vault operation can return. */
export type VaultFailure = VaultError | VaultPathError;

/** Attachments the vault explicitly understands (beyond Markdown notes). */
const ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico',
  // documents
  'pdf', 'txt', 'csv', 'json', 'mdx',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'epub',
  // archives
  'zip',
]);

export function isAttachmentPath(vaultPath: string): boolean {
  const extension = getVaultExtension(vaultPath);
  return extension.length > 0 && ATTACHMENT_EXTENSIONS.has(extension);
}

export interface ReadResult {
  readonly content: string;
  readonly mtimeMs: number;
  readonly size: number;
}

export interface WriteOptions {
  /**
   * When provided, the write is refused with `VAULT_MODIFIED_SINCE_READ` if
   * the file's current mtime differs — the editor's guard against clobbering
   * external edits.
   */
  readonly expectedMtimeMs?: number;
}

export interface WriteResult {
  readonly mtimeMs: number;
}

export interface TrashEntry {
  readonly id: string;
  readonly originalPath: string;
  readonly deletedAt: string;
  readonly kind: 'file' | 'directory';
}

export interface VaultFileEvent {
  readonly kind: 'created' | 'changed' | 'deleted';
  readonly vaultPath: string;
}

export interface VaultEvents {
  readonly onFileEvent: (event: VaultFileEvent) => void;
  readonly onError: (error: Error) => void;
}

interface TrashManifest {
  readonly id: string;
  readonly originalPath: string;
  readonly deletedAt: string;
  readonly kind: 'file' | 'directory';
}

const TRASH_DIR_NAME = 'trash';
const TRASH_ENTRY_CONTENT = 'content';
const TRASH_MANIFEST_FILE = 'entry.json';

/**
 * A local Markdown vault: one root directory of ordinary files.
 *
 * All public methods address content by vault-relative path, validate it with
 * the shared path algebra, verify containment against the root's *real*
 * path (symlink-escape resistant), and refuse to touch the reserved
 * application directory. Deletion always goes to the in-vault trash; nothing
 * is ever silently destroyed.
 */
export class Vault {
  readonly root: string;
  readonly vaultId: string;
  private readonly rootReal: string;
  private watcher: { close(): void } | null = null;

  private constructor(root: string, rootReal: string, vaultId: string) {
    this.root = root;
    this.rootReal = rootReal;
    this.vaultId = vaultId;
  }

  /** Opens an existing directory as a vault (initializing the app dir). */
  static async open(rootPath: string): Promise<Result<Vault, VaultError>> {
    const absolute = path.resolve(rootPath);
    let real: string;
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isDirectory()) {
        return err(
          new VaultError('VAULT_ROOT_INVALID', 'Vault root is not a directory', {
            details: { absolute },
          }),
        );
      }
      real = await fs.realpath(absolute);
    } catch (error) {
      return err(new VaultError('VAULT_ROOT_INVALID', 'Vault root does not exist', {
        details: { absolute },
        cause: error,
      }));
    }
    const appDir = path.join(real, APP_DIR_NAME);
    try {
      await fs.mkdir(appDir, { recursive: true });
    } catch (error) {
      return err(new VaultError('VAULT_APP_DIR_LOCKED', 'Cannot create the application directory', {
        details: { appDir },
        cause: error,
      }));
    }
    const manifestPath = path.join(appDir, 'vault.json');
    let vaultId: string;
    try {
      const raw = await fs.readFile(manifestPath, 'utf8').catch(() => null);
      if (raw === null) {
        vaultId = createVaultId();
        await atomicWriteFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, vaultId })}\n`);
      } else {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || (parsed as Record<string, unknown>)['schemaVersion'] !== 1 || typeof (parsed as Record<string, unknown>)['vaultId'] !== 'string') {
          return err(new VaultError('VAULT_IDENTITY_INVALID', 'Vault identity manifest is invalid'));
        }
        vaultId = (parsed as { vaultId: string }).vaultId;
      }
    } catch (error) {
      return err(new VaultError('VAULT_IDENTITY_INVALID', 'Cannot initialize vault identity', { cause: error }));
    }
    return ok(new Vault(absolute, real, vaultId));
  }

  /**
   * Creates a new vault. The target must not exist, or exist as an empty
   * directory — never initializes over unrelated content.
   */
  static async create(rootPath: string): Promise<Result<Vault, VaultError>> {
    const absolute = path.resolve(rootPath);
    try {
      const entries = await fs.readdir(absolute, { withFileTypes: true });
      const meaningful = entries.filter((entry) => entry.name !== APP_DIR_NAME);
      if (meaningful.length > 0) {
        return err(
          new VaultError(
            'VAULT_ROOT_NOT_EMPTY_FILE_CONFLICT',
            'Cannot create a vault here: the directory is not empty',
            { details: { absolute } },
          ),
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return err(new VaultError('VAULT_ROOT_INVALID', 'Vault root is not accessible', {
          details: { absolute },
          cause: error,
        }));
      }
      await fs.mkdir(absolute, { recursive: true });
    }
    return Vault.open(absolute);
  }

  /** Stops the file watcher, if one is running. */
  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  get appDir(): string {
    return path.join(this.rootReal, APP_DIR_NAME);
  }

  private trashDir(): string {
    return path.join(this.appDir, TRASH_DIR_NAME);
  }

  private isAppOwned(vaultPath: string): boolean {
    return vaultPath === APP_DIR_NAME || vaultPath.startsWith(`${APP_DIR_NAME}/`);
  }

  /**
   * Validates a vault path, lexically resolves it inside the root, then
   * verifies that the *real* path (symlinks resolved) stays inside the root.
   * Application-dir paths are refused outright.
   */
  private async resolveTarget(vaultPath: string): Promise<Result<string, VaultFailure>> {
    const normalized = normalizeVaultPath(vaultPath);
    if (!normalized.ok) {
      return normalized;
    }
    if (this.isAppOwned(normalized.value)) {
      return err(
        new VaultError('VAULT_ESCAPE_BLOCKED', 'The application directory is not vault content', {
          details: { vaultPath: normalized.value },
        }),
      );
    }
    const lexical = resolveInsideRoot(this.rootReal, normalized.value);
    if (!lexical.ok) {
      return err(
        new VaultError('VAULT_ESCAPE_BLOCKED', 'Resolved path escapes the vault root', {
          details: { vaultPath: normalized.value, escapePath: lexical.escapePath },
        }),
      );
    }
    return this.realpathInside(lexical.absolutePath);
  }

  private async realpathInside(absolutePath: string): Promise<Result<string, VaultError>> {
    const check = (candidate: string): Result<string, VaultError> => {
      if (isInside(this.rootReal, candidate)) {
        return ok(candidate);
      }
      return err(
        new VaultError('VAULT_ESCAPE_BLOCKED', 'Path resolves outside the vault (symlink?)', {
          details: { absolutePath, resolved: candidate },
        }),
      );
    };
    try {
      return check(await fs.realpath(absolutePath));
    } catch {
      // Target does not exist: resolve the deepest existing ancestor and
      // re-attach the remaining segments, so a symlinked directory anywhere
      // in the chain is still caught.
      let parent = path.dirname(absolutePath);
      for (;;) {
        try {
          const parentReal = await fs.realpath(parent);
          const candidate = path.join(parentReal, path.relative(parent, absolutePath));
          return check(candidate);
        } catch {
          const next = path.dirname(parent);
          if (next === parent) {
            return check(absolutePath);
          }
          parent = next;
        }
      }
    }
  }

  async exists(vaultPath: string): Promise<Result<boolean, VaultFailure>> {
    const target = await this.resolveTarget(vaultPath);
    if (!target.ok) {
      return target;
    }
    try {
      await fs.lstat(target.value);
      return ok(true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return ok(false);
      }
      return err(new VaultError('VAULT_READ_FAILED', 'Cannot inspect path', { cause: error }));
    }
  }

  async readFile(vaultPath: string): Promise<Result<ReadResult, VaultFailure>> {
    const target = await this.resolveTarget(vaultPath);
    if (!target.ok) {
      return target;
    }
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(target.value, 'utf8'),
        fs.stat(target.value),
      ]);
      return ok({ content, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return err(
          new VaultError('VAULT_PATH_NOT_FOUND', 'File not found', { details: { vaultPath } }),
        );
      }
      if (code === 'EISDIR') {
        return err(
          new VaultError('VAULT_PATH_IS_DIRECTORY', 'Path is a directory', {
            details: { vaultPath },
          }),
        );
      }
      return err(new VaultError('VAULT_READ_FAILED', 'Cannot read file', { cause: error }));
    }
  }

  /** Reads an attachment as raw bytes (images, PDFs, office documents). */
  async readBinary(
    vaultPath: string,
  ): Promise<Result<{ bytes: Uint8Array; mtimeMs: number; size: number }, VaultFailure>> {
    const target = await this.resolveTarget(vaultPath);
    if (!target.ok) {
      return target;
    }
    try {
      const [bytes, stat] = await Promise.all([fs.readFile(target.value), fs.stat(target.value)]);
      return ok({ bytes, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return err(
          new VaultError('VAULT_PATH_NOT_FOUND', 'File not found', { details: { vaultPath } }),
        );
      }
      if (code === 'EISDIR') {
        return err(
          new VaultError('VAULT_PATH_IS_DIRECTORY', 'Path is a directory', {
            details: { vaultPath },
          }),
        );
      }
      return err(new VaultError('VAULT_READ_FAILED', 'Cannot read file', { cause: error }));
    }
  }

  /**
   * Atomically writes text content (creating parent directories as needed).
   * Pass `expectedMtimeMs` from the originating read to make external-edit
   * conflicts visible instead of silently overwriting them.
   */
  async writeFile(
    vaultPath: string,
    content: string,
    options?: WriteOptions,
  ): Promise<Result<WriteResult, VaultFailure>> {
    const target = await this.resolveTarget(vaultPath);
    if (!target.ok) {
      return target;
    }
    const absolutePath = target.value;
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      if (options?.expectedMtimeMs !== undefined) {
        try {
          const stat = await fs.stat(absolutePath);
          if (Math.abs(stat.mtimeMs - options.expectedMtimeMs) > 0.5) {
            return err(
              new VaultError('VAULT_MODIFIED_SINCE_READ', 'File changed since it was read', {
                details: { vaultPath, expected: options.expectedMtimeMs, actual: stat.mtimeMs },
              }),
            );
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
        }
      }
      await atomicWriteFile(absolutePath, content);
      const stat = await fs.stat(absolutePath);
      return ok({ mtimeMs: stat.mtimeMs });
    } catch (error) {
      return err(
        new VaultError('VAULT_WRITE_FAILED', 'Cannot write file', {
          details: { vaultPath },
          cause: error,
        }),
      );
    }
  }

  /**
   * Renames/moves a note or attachment. Refuses to overwrite an existing
   * target; never touches the application directory.
   */
  async rename(fromPath: string, toPath: string): Promise<Result<string, VaultFailure>> {
    const from = await this.resolveTarget(fromPath);
    if (!from.ok) {
      return from;
    }
    const to = await this.resolveTarget(toPath);
    if (!to.ok) {
      return to;
    }
    try {
      const fromStat = await fs.lstat(from.value);
      if (fromStat.isDirectory()) {
        return err(
          new VaultError('VAULT_PATH_IS_DIRECTORY', 'Directory rename is not supported yet', {
            details: { vaultPath: fromPath },
          }),
        );
      }
      await fs.mkdir(path.dirname(to.value), { recursive: true });
      const targetOccupied = await fs
        .lstat(to.value)
        .then(() => true)
        .catch(() => false);
      if (targetOccupied) {
        return err(
          new VaultError('VAULT_PATH_EXISTS', 'Target already exists', { details: { vaultPath: toPath } }),
        );
      }
      await movePath(from.value, to.value);
      return ok(toPath);
    } catch (error) {
      return err(
        new VaultError('VAULT_RENAME_FAILED', 'Cannot rename', {
          details: { fromPath, toPath },
          cause: error,
        }),
      );
    }
  }

  /**
   * Moves a file into the in-vault application trash and returns the entry.
   * Nothing is deleted from disk; `restoreFromTrash` reverses this.
   */
  async deleteToTrash(vaultPath: string): Promise<Result<TrashEntry, VaultFailure>> {
    const target = await this.resolveTarget(vaultPath);
    if (!target.ok) {
      return target;
    }
    try {
      const stat = await fs.lstat(target.value);
      if (stat.isDirectory()) {
        return err(
          new VaultError('VAULT_PATH_IS_DIRECTORY', 'Directory trash is not supported yet', {
            details: { vaultPath },
          }),
        );
      }
      const entry: TrashManifest = {
        id: createId(),
        originalPath: vaultPath,
        deletedAt: new Date().toISOString(),
        kind: 'file',
      };
      const entryDir = path.join(this.trashDir(), entry.id);
      await fs.mkdir(entryDir, { recursive: true });
      await movePath(target.value, path.join(entryDir, TRASH_ENTRY_CONTENT));
      await atomicWriteFile(
        path.join(entryDir, TRASH_MANIFEST_FILE),
        JSON.stringify(entry, null, 2),
      );
      return ok(entry);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return err(
          new VaultError('VAULT_PATH_NOT_FOUND', 'File not found', { details: { vaultPath } }),
        );
      }
      return err(
        new VaultError('VAULT_DELETE_FAILED', 'Cannot move file to trash', {
          details: { vaultPath },
          cause: error,
        }),
      );
    }
  }

  async listTrash(): Promise<Result<readonly TrashEntry[], VaultError>> {
    try {
      const entries = await fs.readdir(this.trashDir(), { withFileTypes: true });
      const manifests: TrashEntry[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        try {
          const raw = await fs.readFile(
            path.join(this.trashDir(), entry.name, TRASH_MANIFEST_FILE),
            'utf8',
          );
          manifests.push(parseTrashManifest(raw, entry.name));
        } catch {
          // Unreadable manifests are skipped, never invented.
        }
      }
      manifests.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
      return ok(manifests);
    } catch (error) {
      return err(new VaultError('VAULT_READ_FAILED', 'Cannot list trash', { cause: error }));
    }
  }

  /**
   * Restores a trashed entry to its original path. Fails with
   * `VAULT_RESTORE_CONFLICT` if something new now occupies that path —
   * restore never overwrites.
   */
  async restoreFromTrash(entryId: string): Promise<Result<string, VaultError>> {
    if (!/^[0-9a-f-]{36}$/i.test(entryId)) {
      return err(
        new VaultError('VAULT_TRASH_ENTRY_NOT_FOUND', 'Invalid trash entry id', {
          details: { entryId },
        }),
      );
    }
    const entryDir = path.join(this.trashDir(), entryId);
    let raw: string;
    try {
      raw = await fs.readFile(path.join(entryDir, TRASH_MANIFEST_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return err(
          new VaultError('VAULT_TRASH_ENTRY_NOT_FOUND', 'No such trash entry', {
            details: { entryId },
          }),
        );
      }
      return err(
        new VaultError('VAULT_READ_FAILED', 'Cannot read trash entry', {
          details: { entryId },
          cause: error,
        }),
      );
    }
    try {
      const manifest = parseTrashManifest(raw, entryId);
      const restore = await this.resolveTarget(manifest.originalPath);
      if (!restore.ok) {
        return err(
          new VaultError('VAULT_RESTORE_CONFLICT', 'Original path is no longer addressable', {
            details: { originalPath: manifest.originalPath },
          }),
        );
      }
      const occupied = await fs
        .lstat(restore.value)
        .then(() => true)
        .catch(() => false);
      if (occupied) {
        return err(
          new VaultError('VAULT_RESTORE_CONFLICT', 'Original path is occupied', {
            details: { originalPath: manifest.originalPath },
          }),
        );
      }
      await fs.mkdir(path.dirname(restore.value), { recursive: true });
      await movePath(path.join(entryDir, TRASH_ENTRY_CONTENT), restore.value);
      await fs.rm(entryDir, { recursive: true });
      return ok(manifest.originalPath);
    } catch (error) {
      return err(
        new VaultError('VAULT_RESTORE_CONFLICT', 'Cannot restore entry', {
          details: { entryId },
          cause: error,
        }),
      );
    }
  }

  /**
   * Starts watching the vault for content changes (external edits included).
   * The vault stops the watcher on `close()`; events never include
   * application-dir or temp files.
   */
  async watch(events: VaultEvents): Promise<Result<{ close(): void }, VaultError>> {
    if (this.watcher) {
      return err(new VaultError('VAULT_WATCH_FAILED', 'A watcher is already active'));
    }
    const { createVaultWatcher } = await import('./watcher.js');
    const started = createVaultWatcher(this.root, (event) => {
      if (event.kind === 'error') {
        events.onError(event.error);
        return;
      }
      events.onFileEvent(event);
    });
    if (!started.ok) {
      return started;
    }
    this.watcher = started.value;
    return started;
  }
}

function parseTrashManifest(raw: string, entryId: string): TrashEntry {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('trash manifest is not an object');
  }
  const record = parsed as Record<string, unknown>;
  const originalPath = record['originalPath'];
  const deletedAt = record['deletedAt'];
  const kind = record['kind'];
  if (typeof originalPath !== 'string' || typeof deletedAt !== 'string') {
    throw new Error('trash manifest is missing required fields');
  }
  if (kind !== 'file' && kind !== 'directory') {
    throw new Error('trash manifest has an invalid kind');
  }
  return { id: entryId, originalPath, deletedAt, kind };
}

/** Opens an existing directory as a vault. */
export function openVault(rootPath: string): Promise<Result<Vault, VaultError>> {
  return Vault.open(rootPath);
}

/** Creates a new, empty vault. */
export function createVault(rootPath: string): Promise<Result<Vault, VaultError>> {
  return Vault.create(rootPath);
}
