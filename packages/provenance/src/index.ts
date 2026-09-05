import fs from 'node:fs/promises';
import path from 'node:path';
import { readMetadata } from '@knowledge-studio/metadata';
import { isUuidV4, sourceIdFor, type Result, ok, err } from '@knowledge-studio/shared';
import { atomicWriteFile, walkVault, type Vault } from '@knowledge-studio/vault';

export const PROVENANCE_FORMAT = 'knowledge-studio.provenance' as const;
export const PROVENANCE_VERSION = 1 as const;
export type SourceType = 'markdown' | 'pdf' | 'web' | 'zotero' | 'attachment' | 'imported';
export type SourceOrigin = 'local' | 'external';

export interface CitationLocator { readonly page?: number; readonly heading?: string; readonly range?: string; readonly chunkId?: string; readonly annotationId?: string; }
export interface ProvenanceRecord {
  readonly id: string;
  readonly sourceId: string;
  readonly documentId?: string;
  readonly sourceType: SourceType;
  readonly origin: SourceOrigin;
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly year?: number;
  readonly url?: string;
  readonly localRef?: string;
  readonly locator?: CitationLocator;
  readonly importedAt?: string;
  readonly sourceUpdatedAt?: string;
  readonly externalSourceId?: string;
  readonly citationKey?: string;
  readonly state?: 'available' | 'missing' | 'degraded';
}
export interface ProvenanceFile { readonly format: typeof PROVENANCE_FORMAT; readonly schemaVersion: typeof PROVENANCE_VERSION; readonly vaultId: string; readonly revision: number; readonly records: readonly ProvenanceRecord[]; }
export interface MachineCitation { readonly sourceId: string; readonly documentId?: string; readonly sourceType: SourceType; readonly title?: string; readonly authors?: readonly string[]; readonly year?: number; readonly url?: string; readonly locator?: CitationLocator; }
export type Resolution = { readonly state: 'resolved'; readonly sourceId: string; readonly documentId: string; readonly path: string } | { readonly state: 'missing'; readonly sourceId: string; readonly documentId: string } | { readonly state: 'ambiguous'; readonly sourceId: string; readonly documentId: string; readonly paths: readonly string[] } | { readonly state: 'invalid'; readonly path: string };
export type ProvenanceError = { readonly code: string; readonly message: string };

function isProvenanceRecord(value: unknown): value is ProvenanceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record['id'] === 'string' && typeof record['sourceId'] === 'string' && typeof record['sourceType'] === 'string' && typeof record['origin'] === 'string';
}

function validRecord(record: ProvenanceRecord, vaultId: string): boolean {
  if (!isUuidV4(record.id) || !record.sourceType || !record.origin) return false;
  if (record.documentId && (!isUuidV4(record.documentId) || record.sourceId !== sourceIdFor(vaultId, record.documentId))) return false;
  return !(record.locator?.page !== undefined && (!Number.isInteger(record.locator.page) || record.locator.page < 1));
}
function empty(vaultId: string): ProvenanceFile { return { format: PROVENANCE_FORMAT, schemaVersion: PROVENANCE_VERSION, vaultId, revision: 0, records: [] }; }

export class ProvenanceStore {
  constructor(private readonly vault: Vault) {}
  private get filePath(): string { return path.join(this.vault.appDir, 'provenance.json'); }
  async load(): Promise<Result<ProvenanceFile, ProvenanceError>> {
    const raw = await fs.readFile(this.filePath, 'utf8').catch(() => null);
    if (raw === null) return ok(empty(this.vault.vaultId));
    try {
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null) return err({ code: 'PROVENANCE_FILE_INVALID', message: 'Provenance file is invalid' });
      const file = value as ProvenanceFile;
      const records = (file as { records: unknown }).records;
      if (file.format !== PROVENANCE_FORMAT || file.schemaVersion !== PROVENANCE_VERSION || !Array.isArray(records) || !Number.isInteger(file.revision)) return err({ code: 'PROVENANCE_VERSION_UNSUPPORTED', message: 'Provenance format or version is unsupported' });
      if (!records.every(isProvenanceRecord)) return err({ code: 'PROVENANCE_FILE_INVALID', message: 'Provenance records are invalid or duplicated' });
      const typedRecords = records as readonly ProvenanceRecord[];
      if (file.vaultId !== this.vault.vaultId) return err({ code: 'PROVENANCE_VAULT_MISMATCH', message: 'Provenance belongs to another vault' });
      if (new Set(typedRecords.map((record) => record.id)).size !== typedRecords.length || !typedRecords.every((record) => validRecord(record, file.vaultId))) return err({ code: 'PROVENANCE_FILE_INVALID', message: 'Provenance records are invalid or duplicated' });
      return ok({ ...file, records: typedRecords });
    } catch { return err({ code: 'PROVENANCE_FILE_INVALID', message: 'Provenance JSON cannot be parsed' }); }
  }
  async upsert(record: ProvenanceRecord, expectedRevision?: number): Promise<Result<ProvenanceFile, ProvenanceError>> {
    const loaded = await this.load(); if (!loaded.ok) return loaded;
    if (expectedRevision !== undefined && expectedRevision !== loaded.value.revision) return err({ code: 'PROVENANCE_CONFLICT', message: 'Provenance changed before this update' });
    if (!validRecord(record, this.vault.vaultId)) return err({ code: 'PROVENANCE_RECORD_INVALID', message: 'Provenance record is invalid' });
    const records = [...loaded.value.records.filter((entry) => entry.id !== record.id), record].sort((a, b) => a.id.localeCompare(b.id));
    const next: ProvenanceFile = { ...loaded.value, revision: loaded.value.revision + 1, records };
    await atomicWriteFile(this.filePath, `${JSON.stringify(next, null, 2)}\n`);
    return ok(next);
  }
  async resolveDocumentProvenance(documentId: string): Promise<Result<Resolution, ProvenanceError>> {
    if (!isUuidV4(documentId)) return err({ code: 'DOCUMENT_ID_INVALID', message: 'Document identity is invalid' });
    const entries = await walkVault(this.vault.root); if (!entries.ok) return err({ code: 'PROVENANCE_VAULT_SCAN_FAILED', message: entries.error.message });
    const paths: string[] = [];
    for (const entry of entries.value) {
      if (entry.kind !== 'note') continue;
      const note = await this.vault.readFile(entry.path); if (!note.ok) continue;
      const metadata = readMetadata(note.value.content);
      if (metadata.data.id === documentId) paths.push(entry.path);
    }
    const sourceId = sourceIdFor(this.vault.vaultId, documentId);
    if (paths.length === 0) return ok({ state: 'missing', sourceId, documentId });
    if (paths.length > 1) return ok({ state: 'ambiguous', sourceId, documentId, paths: paths.sort((a, b) => a.localeCompare(b, 'en')) });
    return ok({ state: 'resolved', sourceId, documentId, path: paths[0]! });
  }
  async resolveSourceProvenance(sourceId: string): Promise<Result<Resolution, ProvenanceError>> {
    const prefix = `ks:${this.vault.vaultId}:`;
    if (!sourceId.startsWith(prefix)) return err({ code: 'SOURCE_ID_FOREIGN', message: 'Source identity belongs to another vault' });
    return this.resolveDocumentProvenance(sourceId.slice(prefix.length));
  }
}

export function renderCompactCitation(record: ProvenanceRecord): string {
  const title = record.title ?? record.citationKey ?? record.sourceId;
  if (record.sourceType === 'pdf' && record.locator?.page) return `${title}, p. ${record.locator.page}`;
  if (record.sourceType === 'markdown' && record.locator?.heading) return `${title} § ${record.locator.heading}`;
  if (record.sourceType === 'web' && record.url) { try { return `${title} — ${new URL(record.url).hostname}`; } catch { return title; } }
  if (record.sourceType === 'zotero' && record.authors?.[0]) return `${record.authors[0]}${record.year ? `, ${record.year}` : ''} — ${title}`;
  return title;
}
export function toMachineCitation(record: ProvenanceRecord): MachineCitation {
  return { sourceId: record.sourceId, ...(record.documentId ? { documentId: record.documentId } : {}), sourceType: record.sourceType, ...(record.title ? { title: record.title } : {}), ...(record.authors ? { authors: record.authors } : {}), ...(record.year ? { year: record.year } : {}), ...(record.url ? { url: record.url } : {}), ...(record.locator ? { locator: record.locator } : {}) };
}
