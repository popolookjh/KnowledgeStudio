import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Filesystem containment helpers.
 *
 * Defense in depth: every vault path is already validated by the pure path
 * algebra in `@knowledge-studio/shared` before it reaches this module. These
 * helpers add the filesystem-level guarantee — whatever string arrives, the
 * resolved absolute path must remain inside the vault root, or the operation
 * is refused (`VAULT_ESCAPE_BLOCKED`).
 */

/** Resolved absolute path with a trailing separator removed, for comparisons. */
function normalizeAbs(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  return resolved.length > 1 && resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
}

/** True when `candidate` is `root` itself or located underneath it. */
export function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeAbs(root);
  const normalizedCandidate = normalizeAbs(candidate);
  if (normalizedCandidate === normalizedRoot) {
    return true;
  }
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  return process.platform === 'win32'
    ? normalizedCandidate.toLowerCase().startsWith(rootWithSep.toLowerCase())
    : normalizedCandidate.startsWith(rootWithSep);
}

/**
 * Resolves a validated vault path against the vault root and asserts
 * containment. Returns the absolute filesystem path, or an error result.
 */
export function resolveInsideRoot(
  root: string,
  vaultPath: string,
): { ok: true; absolutePath: string } | { ok: false; escapePath: string } {
  const absolutePath = path.resolve(root, ...vaultPath.split('/'));
  if (!isInside(root, absolutePath)) {
    return { ok: false, escapePath: absolutePath };
  }
  return { ok: true, absolutePath };
}

/**
 * Moves `from` to `to`, falling back to copy-then-delete across devices
 * (e.g. when target directories live on another mount).
 */
export async function movePath(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error;
    }
    const stat = await fs.lstat(from);
    if (stat.isDirectory()) {
      await fs.cp(from, to, { recursive: true });
      await fs.rm(from, { recursive: true });
    } else {
      await fs.copyFile(from, to);
      await fs.rm(from);
    }
  }
}

/**
 * Writes `data` to `absolutePath` atomically: a temp file in the same
 * directory (same volume, so the final rename is atomic) followed by
 * rename-over-target. The target is either fully old or fully new content —
 * a crash can never leave a half-written note.
 */
/**
 * Windows refuses to replace a file that another handle (watcher, indexer,
 * antivirus, or an overlapping save) briefly holds open, failing with
 * EPERM/EACCES/EBUSY. Those are transient, so retry with a short backoff.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY')) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}

export async function atomicWriteFile(
  absolutePath: string,
  data: string | Uint8Array,
): Promise<void> {
  const directory = path.dirname(absolutePath);
  const basename = path.basename(absolutePath);
  const tempPath = path.join(directory, `.${basename}.ks-tmp-${randomBytes(6).toString('hex')}`);
  try {
    const handle = await fs.open(tempPath, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tempPath, absolutePath);
  } catch (error) {
    // Best-effort cleanup of the orphaned temp file; failure to clean up
    // must not mask the original error.
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
