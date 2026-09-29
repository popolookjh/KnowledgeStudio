import { applyFieldEdit, BaseStore, collectBaseInputs, isSafeBaseId, parseBaseDefinition, parseFieldEdit, queryBase, toRowView } from '@knowledge-studio/bases';
import type { BaseQueryDto, BaseSummaryDto, RpcResult, StoredBaseDto } from '../shared/ipc-contract.js';
import type { TrustedNoteWriter } from './trusted-note-writer.js';
import { serializeFailure } from './trusted-note-writer.js';

/**
 * Trusted main-process Base host. Renderer arguments arrive as `unknown` and
 * are runtime-validated here before touching the vault. Query results carry
 * only the requested metadata fields (never note bodies). Inline edits go
 * through the canonical metadata writer and the TrustedNoteWriter, so they
 * get optimistic concurrency, history, document identity, and change-feed
 * events exactly like editor saves.
 */
export class BasesHost {
  private readonly store: BaseStore;

  constructor(private readonly writer: TrustedNoteWriter) {
    this.store = new BaseStore(writer.vault);
  }

  async list(): Promise<RpcResult<readonly BaseSummaryDto[]>> {
    const listed = await this.store.list();
    if (!listed.ok) return { ok: false, error: listed.error };
    const summaries: BaseSummaryDto[] = [];
    for (const definition of listed.value) {
      const stored = await this.store.read(definition.id);
      if (stored.ok) summaries.push({ id: definition.id, name: definition.name, view: definition.view, revision: stored.value.revision });
    }
    return { ok: true, value: summaries };
  }

  async save(definition: unknown, expectedRevision: unknown): Promise<RpcResult<StoredBaseDto>> {
    const parsed = parseBaseDefinition(definition);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (expectedRevision !== undefined && expectedRevision !== null && (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision))) return { ok: false, error: { code: 'BASE_INVALID', message: 'Expected revision is invalid' } };
    const saved = typeof expectedRevision === 'number' ? await this.store.update(parsed.value, expectedRevision) : await this.store.create(parsed.value);
    return saved.ok ? { ok: true, value: { revision: saved.value.revision, definition: saved.value.definition } } : { ok: false, error: saved.error };
  }

  async remove(id: unknown, expectedRevision: unknown): Promise<RpcResult<true>> {
    if (!isSafeBaseId(id) || typeof expectedRevision !== 'number') return { ok: false, error: { code: 'BASE_INVALID', message: 'Base ID or revision is invalid' } };
    const removed = await this.store.remove(id, expectedRevision);
    return removed.ok ? { ok: true, value: true } : { ok: false, error: removed.error };
  }

  async query(id: unknown): Promise<RpcResult<BaseQueryDto>> {
    if (!isSafeBaseId(id)) return { ok: false, error: { code: 'BASE_ID_INVALID', message: 'Base ID is invalid' } };
    const stored = await this.store.read(id);
    if (!stored.ok) return { ok: false, error: stored.error };
    const definition = stored.value.definition;
    const started = performance.now();
    const rows = queryBase(definition, await collectBaseInputs(this.writer.vault, definition.folder));
    const fields = [...new Set([...definition.fields, ...(definition.groupBy ? [definition.groupBy] : [])])];
    return { ok: true, value: { base: { revision: stored.value.revision, definition }, total: rows.length, rows: rows.map((row) => toRowView(row, fields)), elapsedMs: Math.round(performance.now() - started) } };
  }

  /** Inline metadata edit through the trusted metadata + note write path. */
  async setField(edit: unknown): Promise<RpcResult<{ path: string; mtimeMs: number }>> {
    const parsed = parseFieldEdit(edit);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const { path, key, value, expectedMtimeMs } = parsed.value;
    const current = await this.writer.vault.readFile(path);
    if (!current.ok) return { ok: false, error: serializeFailure(current.error) };
    const updated = applyFieldEdit(current.value.content, key, value);
    if (!updated.ok) return { ok: false, error: { code: 'METADATA_INVALID', message: updated.error.map((issue) => issue.message).join('; ') } };
    const written = await this.writer.write(path, updated.value, { expectedMtimeMs, changeType: 'metadata_changed', changeMetadata: { field: key } });
    return written.ok ? { ok: true, value: { path, mtimeMs: written.value.mtimeMs } } : written;
  }
}
