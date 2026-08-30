import { err, ok, type Result } from '@knowledge-studio/shared';
import fs from 'node:fs';
import path from 'node:path';
import { VaultError } from './errors.js';
import { APP_DIR_NAME, type VaultFileEvent } from './vault.js';

/**
 * Recursive vault watcher built on `fs.watch` (recursive on all supported
 * platforms in Node ≥ 20). Raw OS events are noisy and platform-specific:
 * Windows reports create AND delete as `rename`, edits often arrive in
 * bursts (create then several changes). This layer classifies each change
 * with an existence probe plus remembered path state, then debounces bursts
 * into one event per path. Semantics: the first event for a path is
 * `created` even if the file existed before watching started (an upsert),
 * so indexers never need a special case.
 */

const DEBOUNCE_MS = 150;
/** Temp-file prefix used by atomic writes; never surfaced as an event. */
const TEMP_PREFIX = '.ks-tmp-';

export type WatcherEvent = VaultFileEvent | { kind: 'error'; error: Error };

interface PendingEvent {
  vaultPath: string;
  kind: 'created' | 'changed' | 'deleted';
}

/** Merges a burst of classifications for one path into a stable kind. */
function mergeKind(
  previous: 'created' | 'changed' | 'deleted' | undefined,
  next: 'created' | 'changed' | 'deleted',
): 'created' | 'changed' | 'deleted' {
  if (previous === undefined) {
    return next;
  }
  // A fresh file often reports rename+change in one burst: stays `created`.
  if (previous === 'created' && next === 'changed') {
    return 'created';
  }
  // Deleted then recreated within a burst reads as a modification.
  if (previous === 'deleted' && (next === 'created' || next === 'changed')) {
    return 'changed';
  }
  return next;
}

export function createVaultWatcher(
  root: string,
  onEvent: (event: WatcherEvent) => void,
): Result<{ close(): void }, VaultError> {
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(root, { recursive: true }, handleRawEvent);
  } catch (error) {
    return err(
      new VaultError('VAULT_WATCH_FAILED', 'Cannot watch the vault root', { cause: error }),
    );
  }

  const pending = new Map<string, PendingEvent>();
  /** Paths already reported as existing (state for created-vs-changed). */
  const known = new Set<string>();
  let flushTimer: NodeJS.Timeout | null = null;
  let closed = false;

  function scheduleFlush(): void {
    if (flushTimer !== null || closed) {
      return;
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const events = [...pending.values()].sort((a, b) => a.vaultPath.localeCompare(b.vaultPath));
      pending.clear();
      for (const event of events) {
        onEvent(event);
      }
    }, DEBOUNCE_MS);
    // Do not keep the process alive just for a pending flush.
    flushTimer.unref?.();
  }

  function shouldIgnore(relative: string): boolean {
    const normalized = relative.split(path.sep).join('/');
    const firstSegment = normalized.split('/')[0] ?? '';
    if (firstSegment === APP_DIR_NAME || firstSegment === '.git') {
      return true;
    }
    const basename = path.posix.basename(normalized);
    return basename.includes(TEMP_PREFIX) || basename.startsWith('.');
  }

  async function classify(relative: string, _rawKind: string): Promise<void> {
    if (shouldIgnore(relative)) {
      return;
    }
    const vaultPath = relative.split(path.sep).join('/');
    let exists = false;
    try {
      await fs.promises.lstat(path.join(root, relative));
      exists = true;
    } catch {
      exists = false;
    }
    let kind: PendingEvent['kind'];
    if (exists) {
      kind = known.has(vaultPath) ? 'changed' : 'created';
      known.add(vaultPath);
    } else {
      kind = 'deleted';
      known.delete(vaultPath);
    }
    const previous = pending.get(vaultPath);
    const merged = mergeKind(previous?.kind, kind);
    pending.set(vaultPath, { vaultPath, kind: merged });
    scheduleFlush();
  }

  function handleRawEvent(rawKind: string, filename: string | Buffer | null): void {
    if (closed || filename === null) {
      return;
    }
    const relative = Buffer.isBuffer(filename) ? filename.toString('utf8') : filename;
    if (relative.length === 0) {
      return;
    }
    void classify(relative, rawKind).catch((error: unknown) => {
      onEvent({ kind: 'error', error: error instanceof Error ? error : new Error(String(error)) });
    });
  }

  watcher.on('error', (error: Error) => {
    onEvent({ kind: 'error', error });
  });

  return ok({
    close(): void {
      closed = true;
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pending.clear();
      watcher.close();
    },
  });
}
