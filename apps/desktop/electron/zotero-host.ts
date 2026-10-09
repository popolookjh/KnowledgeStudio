import fs from 'node:fs/promises';
import { readMetadata, writeMetadata } from '@knowledge-studio/metadata';
import { ProvenanceStore, type ProvenanceRecord } from '@knowledge-studio/provenance';
import { createId, sourceIdFor } from '@knowledge-studio/shared';
import { walkVault } from '@knowledge-studio/vault';
import {
  fetchLocalZoteroItems,
  literatureMetadata,
  literatureNote,
  literatureNotePath,
  MAX_IMPORT_BYTES,
  parseBibtex,
  parseCslJson,
  type FetchLike,
  type ZoteroItem,
} from '@knowledge-studio/zotero';
import type { RpcResult, ZoteroImportResultDto } from '../shared/ipc-contract.js';
import type { TrustedNoteWriter } from './trusted-note-writer.js';

/**
 * Trusted Zotero importer/sync. Items are matched to existing literature
 * notes through provenance (`externalSourceId = zotero:<key>`), so re-imports
 * update source-owned frontmatter in place (keeping the user's note body
 * and custom properties) instead of duplicating notes.
 */
export class ZoteroHost {
  private readonly provenance: ProvenanceStore;

  constructor(
    private readonly writer: TrustedNoteWriter,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {
    this.provenance = new ProvenanceStore(writer.vault);
  }

  async importFile(filePath: string, now = new Date()): Promise<RpcResult<ZoteroImportResultDto>> {
    const isJson = /\.json$/i.test(filePath);
    if (!isJson && !/\.bib$/i.test(filePath))
      return {
        ok: false,
        error: {
          code: 'ZOTERO_INVALID',
          message: 'Choose a CSL JSON (.json) or BibTeX (.bib) export',
        },
      };
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile())
      return { ok: false, error: { code: 'ZOTERO_INVALID', message: 'Export file was not found' } };
    if (stat.size > MAX_IMPORT_BYTES)
      return { ok: false, error: { code: 'ZOTERO_INVALID', message: 'Export exceeds 20 MB' } };
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = isJson ? parseCslJson(text) : parseBibtex(text);
    return parsed.ok ? this.importItems(parsed.value, now) : { ok: false, error: parsed.error };
  }

  async syncLocal(port: unknown, now = new Date()): Promise<RpcResult<ZoteroImportResultDto>> {
    const fetched = await fetchLocalZoteroItems(
      typeof port === 'number' ? port : Number.NaN,
      this.fetchImpl,
    );
    return fetched.ok ? this.importItems(fetched.value, now) : { ok: false, error: fetched.error };
  }

  async importItems(
    items: readonly ZoteroItem[],
    now = new Date(),
  ): Promise<RpcResult<ZoteroImportResultDto>> {
    const vault = this.writer.vault;
    const loaded = await this.provenance.load();
    if (!loaded.ok) return { ok: false, error: loaded.error };
    const byExternal = new Map(
      loaded.value.records
        .filter((record) => record.externalSourceId?.startsWith('zotero:'))
        .map((record) => [record.externalSourceId!, record]),
    );
    // One vault scan maps document IDs to current paths (notes may have been renamed).
    const pathById = new Map<string, string>();
    const taken = new Set<string>();
    const entries = await walkVault(vault.root);
    if (entries.ok) {
      for (const entry of entries.value) {
        taken.add(entry.path);
        if (entry.kind !== 'note') continue;
        const read = await vault.readFile(entry.path);
        const id = read.ok ? readMetadata(read.value.content).data.id : undefined;
        if (typeof id === 'string') pathById.set(id, entry.path);
      }
    }
    const records: ProvenanceRecord[] = [];
    const result = { created: 0, updated: 0, unchanged: 0, failed: 0, paths: [] as string[] };
    for (const item of items) {
      const externalSourceId = `zotero:${item.key}`;
      const existing = byExternal.get(externalSourceId);
      const existingPath = existing?.documentId ? pathById.get(existing.documentId) : undefined;
      const base = {
        sourceType: 'zotero' as const,
        origin: 'external' as const,
        title: item.title,
        authors: item.authors,
        ...(item.year ? { year: item.year } : {}),
        ...(item.url ? { url: item.url } : {}),
        ...(item.citationKey ? { citationKey: item.citationKey } : {}),
        externalSourceId,
        state: 'available' as const,
      };
      if (existing && existingPath) {
        const read = await vault.readFile(existingPath);
        if (!read.ok) {
          result.failed += 1;
          continue;
        }
        const current = readMetadata(read.value.content).data;
        const incoming = literatureMetadata(item);
        const tags = [...new Set([...(current.tags ?? []), ...(incoming['tags'] as string[])])];
        const merged = writeMetadata(read.value.content, { ...current, ...incoming, tags });
        if (!merged.ok) {
          result.failed += 1;
          continue;
        }
        if (merged.value === read.value.content) {
          result.unchanged += 1;
          continue;
        }
        const written = await this.writer.write(existingPath, merged.value, {
          expectedMtimeMs: read.value.mtimeMs,
          changeType: 'source_updated',
          changeMetadata: { sourceType: 'zotero', externalSourceId },
        });
        if (!written.ok) {
          result.failed += 1;
          continue;
        }
        records.push({ ...existing, ...base, sourceUpdatedAt: now.toISOString() });
        result.updated += 1;
        result.paths.push(existingPath);
        continue;
      }
      const note = literatureNote(item);
      if (!note.ok) {
        result.failed += 1;
        continue;
      }
      const notePath = literatureNotePath(item, (candidate) => taken.has(candidate));
      const written = await this.writer.write(notePath, note.value, {
        createOnly: true,
        changeType: 'source_imported',
        changeMetadata: { sourceType: 'zotero', externalSourceId },
      });
      if (!written.ok || !written.value.documentId) {
        result.failed += 1;
        continue;
      }
      taken.add(notePath);
      const documentId = written.value.documentId;
      records.push({
        id: existing?.id ?? createId(),
        sourceId: sourceIdFor(vault.vaultId, documentId),
        documentId,
        ...base,
        localRef: notePath,
        importedAt: now.toISOString(),
      });
      result.created += 1;
      result.paths.push(notePath);
    }
    if (records.length > 0) {
      const saved = await this.provenance.upsertMany(records);
      if (!saved.ok) return { ok: false, error: saved.error };
    }
    return { ok: true, value: { ...result, paths: result.paths.slice(0, 50) } };
  }
}
