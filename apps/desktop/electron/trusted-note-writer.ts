import { ChangeFeedStore, type ChangeEvent } from '@knowledge-studio/change-feed';
import type { RevisionStore } from '@knowledge-studio/history';
import { ensureDocumentId } from '@knowledge-studio/metadata';
import type { Vault } from '@knowledge-studio/vault';
import type { RpcError, RpcResult } from '../shared/ipc-contract.js';

/**
 * The single trusted main-process write path for vault notes. Every
 * renderer-initiated or importer-initiated note write goes through here so
 * that document identity, revision history, and the durable change feed
 * stay consistent. This module has no Electron dependency so it is unit
 * testable; it never widens filesystem authority beyond the Vault engine.
 */

export type ChangeInput = Omit<ChangeEvent, 'eventId' | 'sequence' | 'vaultId' | 'occurredAt'>;

export function serializeFailure(error: unknown): RpcError {
  const failure = error as Partial<{ code: string; message: string }>;
  if (typeof failure?.code === 'string' && typeof failure?.message === 'string')
    return { code: failure.code, message: failure.message };
  return { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}

export class TrustedNoteWriter {
  readonly feed: ChangeFeedStore;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly vault: Vault,
    private readonly history: RevisionStore | null,
  ) {
    this.feed = new ChangeFeedStore(vault);
  }

  /** Appends to the change feed; appends are serialized so sequences never race. */
  recordChange(change: ChangeInput): Promise<void> {
    // Feed failures are non-fatal for the user's write; the feed is derived state.
    this.queue = this.queue
      .then(() => this.feed.append(change))
      .then(
        () => undefined,
        () => undefined,
      );
    return this.queue;
  }

  /**
   * Writes a note with optimistic concurrency, assigns a stable document ID
   * to Markdown, records the prior revision, and emits a change event.
   */
  async write(
    vaultPath: string,
    content: string,
    options: {
      readonly expectedMtimeMs?: number;
      readonly createOnly?: boolean;
      readonly changeType?: ChangeInput['type'];
      readonly changeMetadata?: ChangeInput['metadata'];
    } = {},
  ): Promise<RpcResult<{ mtimeMs: number; documentId: string | null }>> {
    const current = await this.vault.readFile(vaultPath);
    if (options.createOnly && current.ok)
      return {
        ok: false,
        error: { code: 'VAULT_PATH_EXISTS', message: 'A file with that name already exists' },
      };
    if (
      current.ok &&
      options.expectedMtimeMs !== undefined &&
      Math.abs(current.value.mtimeMs - options.expectedMtimeMs) > 0.5
    ) {
      // Refuse stale writes before recording history so conflicts leave no trace.
      return {
        ok: false,
        error: { code: 'VAULT_MODIFIED_SINCE_READ', message: 'File changed since it was read' },
      };
    }
    if (current.ok && current.value.content !== content && this.history) {
      try {
        await this.history.record(vaultPath, current.value.content);
      } catch {
        /* history must never block a save */
      }
    }
    let finalContent = content;
    let documentId: string | null = null;
    if (vaultPath.endsWith('.md')) {
      const identified = ensureDocumentId(content);
      if (!identified.ok)
        return {
          ok: false,
          error: {
            code: 'DOCUMENT_ID_INVALID',
            message: identified.error.map((issue) => issue.message).join('; '),
          },
        };
      finalContent = identified.value.content;
      documentId = identified.value.documentId;
    }
    const written = await this.vault.writeFile(
      vaultPath,
      finalContent,
      options.expectedMtimeMs !== undefined
        ? { expectedMtimeMs: options.expectedMtimeMs }
        : undefined,
    );
    if (!written.ok) return { ok: false, error: serializeFailure(written.error) };
    if (!current.ok || current.value.content !== finalContent) {
      await this.recordChange({
        type: options.changeType ?? (current.ok ? 'document_updated' : 'document_created'),
        path: vaultPath,
        ...(documentId ? { documentId, entityId: documentId } : {}),
        ...(options.changeMetadata ? { metadata: options.changeMetadata } : {}),
      });
    }
    return { ok: true, value: { mtimeMs: written.value.mtimeMs, documentId } };
  }
}
