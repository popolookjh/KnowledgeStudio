import { createDocumentId, isUuidV4 } from '@knowledge-studio/shared';
import { readMetadata, writeMetadata } from '@knowledge-studio/metadata';
import { ProvenanceStore } from '@knowledge-studio/provenance';
import { walkVault } from '@knowledge-studio/vault';
import type { IntegrityReportDto, RpcResult } from '../shared/ipc-contract.js';
import type { TrustedNoteWriter } from './trusted-note-writer.js';

/**
 * Identity and provenance diagnostics (Tier 1 integration). Reports notes
 * without a stable document ID, duplicated IDs (usually copied files),
 * unreadable frontmatter, provenance records whose target is gone, and the
 * change-feed cursor. `repair` assigns IDs to notes that lack one and gives
 * copies a fresh ID (the lexicographically first path keeps the original),
 * all through the TrustedNoteWriter so every change is recorded.
 */
export class IntegrityHost {
  constructor(private readonly writer: TrustedNoteWriter) {}

  async report(): Promise<RpcResult<IntegrityReportDto>> {
    const vault = this.writer.vault;
    const entries = await walkVault(vault.root);
    if (!entries.ok)
      return { ok: false, error: { code: entries.error.code, message: entries.error.message } };
    const byId = new Map<string, string[]>();
    const missingId: string[] = [];
    const invalidFrontmatter: string[] = [];
    let notes = 0;
    for (const entry of entries.value) {
      if (entry.kind !== 'note') continue;
      notes += 1;
      const read = await vault.readFile(entry.path);
      if (!read.ok) continue;
      const { data, issues } = readMetadata(read.value.content);
      if (issues.some((issue) => issue.key === '' || issue.key === 'id')) {
        invalidFrontmatter.push(entry.path);
        continue;
      }
      if (typeof data.id === 'string' && isUuidV4(data.id))
        byId.set(data.id, [...(byId.get(data.id) ?? []), entry.path]);
      else missingId.push(entry.path);
    }
    const duplicateIds = [...byId.entries()]
      .filter(([, paths]) => paths.length > 1)
      .map(([id, paths]) => ({ id, paths: [...paths].sort((a, b) => a.localeCompare(b, 'en')) }));
    const provenance = await new ProvenanceStore(vault).load();
    const bySourceType: Record<string, number> = {};
    const unresolvedSources: string[] = [];
    if (provenance.ok) {
      for (const record of provenance.value.records) {
        bySourceType[record.sourceType] = (bySourceType[record.sourceType] ?? 0) + 1;
        let resolved = true;
        if (record.documentId) resolved = byId.has(record.documentId);
        else if (record.localRef) {
          const exists = await vault.exists(record.localRef);
          resolved = exists.ok && exists.value;
        }
        if (!resolved) unresolvedSources.push(record.sourceId);
      }
    }
    const feed = await this.writer.feed.load();
    return {
      ok: true,
      value: {
        vaultId: vault.vaultId,
        notes,
        withId: notes - missingId.length - invalidFrontmatter.length,
        missingId: missingId.sort((a, b) => a.localeCompare(b, 'en')),
        duplicateIds,
        invalidFrontmatter,
        provenance: {
          records: provenance.ok ? provenance.value.records.length : 0,
          bySourceType,
          unresolved: unresolvedSources,
          error: provenance.ok ? null : provenance.error.code,
        },
        changeFeed: {
          cursor: await this.writer.feed.getCurrentCursor(),
          retained: feed.ok ? feed.value.events.length : 0,
          error: feed.ok ? null : feed.error.code,
        },
      },
    };
  }

  async repair(): Promise<
    RpcResult<{ assigned: number; reassigned: number; report: IntegrityReportDto }>
  > {
    const before = await this.report();
    if (!before.ok) return before;
    let assigned = 0;
    let reassigned = 0;
    for (const notePath of before.value.missingId) {
      const read = await this.writer.vault.readFile(notePath);
      if (!read.ok) continue;
      const written = await this.writer.write(notePath, read.value.content, {
        expectedMtimeMs: read.value.mtimeMs,
        changeMetadata: { repair: 'assign-id' },
      });
      if (written.ok) assigned += 1;
    }
    for (const duplicate of before.value.duplicateIds) {
      for (const notePath of duplicate.paths.slice(1)) {
        const read = await this.writer.vault.readFile(notePath);
        if (!read.ok) continue;
        const content = writeMetadata(read.value.content, {
          ...readMetadata(read.value.content).data,
          id: createDocumentId(),
        });
        if (!content.ok) continue;
        const written = await this.writer.write(notePath, content.value, {
          expectedMtimeMs: read.value.mtimeMs,
          changeMetadata: { repair: 'reassign-duplicate-id', previousId: duplicate.id },
        });
        if (written.ok) reassigned += 1;
      }
    }
    const after = await this.report();
    return after.ok ? { ok: true, value: { assigned, reassigned, report: after.value } } : after;
  }
}
