import fs from 'node:fs/promises';
import path from 'node:path';
import { createId, err, ok, type Result } from '@knowledge-studio/shared';
import { atomicWriteFile, type Vault } from '@knowledge-studio/vault';

export const CHANGE_FEED_FORMAT = 'knowledge-studio.change-feed' as const;
export const CHANGE_FEED_VERSION = 1 as const;
export type ChangeType =
  | 'document_created'
  | 'document_updated'
  | 'document_deleted'
  | 'document_moved'
  | 'metadata_changed'
  | 'attachment_added'
  | 'attachment_removed'
  | 'source_imported'
  | 'source_updated'
  | 'annotation_created'
  | 'annotation_updated'
  | 'annotation_deleted';
export interface ChangeEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly vaultId: string;
  readonly type: ChangeType;
  readonly occurredAt: string;
  readonly entityId?: string;
  readonly documentId?: string;
  readonly sourceId?: string;
  readonly oldPath?: string;
  readonly path?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}
interface FeedFile {
  readonly format: typeof CHANGE_FEED_FORMAT;
  readonly schemaVersion: typeof CHANGE_FEED_VERSION;
  readonly vaultId: string;
  readonly earliestSequence: number;
  readonly nextSequence: number;
  readonly events: readonly ChangeEvent[];
}
export interface ChangePage {
  readonly cursor: string;
  readonly changes: readonly ChangeEvent[];
  readonly hasMore: boolean;
}
export type FeedError = {
  readonly code: 'CURSOR_INVALID' | 'CURSOR_FOREIGN' | 'CURSOR_EXPIRED' | 'FEED_INVALID';
  readonly message: string;
};
function empty(vaultId: string): FeedFile {
  return {
    format: CHANGE_FEED_FORMAT,
    schemaVersion: CHANGE_FEED_VERSION,
    vaultId,
    earliestSequence: 1,
    nextSequence: 1,
    events: [],
  };
}

export class ChangeFeedStore {
  constructor(
    private readonly vault: Vault,
    private readonly retention = 10_000,
  ) {}
  private get filePath(): string {
    return path.join(this.vault.appDir, 'change-feed.json');
  }
  private cursor(sequence: number): string {
    return `v1:${this.vault.vaultId}:${sequence}`;
  }
  async getCurrentCursor(): Promise<string> {
    const loaded = await this.load();
    return loaded.ok ? this.cursor(loaded.value.nextSequence - 1) : this.cursor(0);
  }
  async append(
    change: Omit<ChangeEvent, 'eventId' | 'sequence' | 'vaultId' | 'occurredAt'>,
  ): Promise<Result<ChangeEvent, FeedError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    const event: ChangeEvent = {
      ...change,
      eventId: createId(),
      sequence: loaded.value.nextSequence,
      vaultId: this.vault.vaultId,
      occurredAt: new Date().toISOString(),
    };
    const events = [...loaded.value.events, event];
    const kept = events.slice(Math.max(0, events.length - this.retention));
    const next: FeedFile = {
      ...loaded.value,
      earliestSequence: kept[0]?.sequence ?? event.sequence + 1,
      nextSequence: event.sequence + 1,
      events: kept,
    };
    await atomicWriteFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`);
    return ok(event);
  }
  async changesSince(cursor?: string, limit = 100): Promise<Result<ChangePage, FeedError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    const after = this.parseCursor(cursor);
    if (!after.ok) return after;
    if (after.value !== 0 && after.value < loaded.value.earliestSequence - 1)
      return err({ code: 'CURSOR_EXPIRED', message: 'Cursor predates retained change history' });
    const changes = loaded.value.events
      .filter((event) => event.sequence > after.value)
      .slice(0, Math.max(1, Math.min(limit, 500)));
    const last = changes.at(-1)?.sequence ?? after.value;
    return ok({
      cursor: this.cursor(last),
      changes,
      hasMore: loaded.value.events.some((event) => event.sequence > last),
    });
  }
  async load(): Promise<Result<FeedFile, FeedError>> {
    const raw = await fs.readFile(this.filePath, 'utf8').catch(() => null);
    if (raw === null) return ok(empty(this.vault.vaultId));
    try {
      const file = JSON.parse(raw) as FeedFile;
      if (file.format !== CHANGE_FEED_FORMAT || file.schemaVersion !== CHANGE_FEED_VERSION)
        return err({ code: 'FEED_INVALID', message: 'Change feed schema is unsupported' });
      if (file.vaultId !== this.vault.vaultId)
        return err({ code: 'CURSOR_FOREIGN', message: 'Change feed belongs to another vault' });
      return ok(file);
    } catch {
      return err({ code: 'FEED_INVALID', message: 'Change feed cannot be parsed' });
    }
  }
  private parseCursor(cursor: string | undefined): Result<number, FeedError> {
    if (!cursor) return ok(0);
    const parts = cursor.split(':');
    if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d+$/.test(parts[2]!))
      return err({ code: 'CURSOR_INVALID', message: 'Cursor is invalid' });
    if (parts[1] !== this.vault.vaultId)
      return err({ code: 'CURSOR_FOREIGN', message: 'Cursor belongs to another vault' });
    return ok(Number(parts[2]));
  }
}
