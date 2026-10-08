import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RevisionStore } from '@knowledge-studio/history';
import type { RetrievalHit } from '@knowledge-studio/mcp';
import { Vault } from '@knowledge-studio/vault';
import type { FetchLike } from '@knowledge-studio/zotero';
import { BasesHost } from '../electron/bases-host';
import { WebClipperHost } from '../electron/clipper-host';
import { IntegrityHost } from '../electron/integrity-host';
import { createVaultMcpDataSource } from '../electron/mcp-vault-source';
import { PdfHost } from '../electron/pdf-host';
import { TrustedNoteWriter } from '../electron/trusted-note-writer';
import { ZoteroHost } from '../electron/zotero-host';

let root = '';
let vault: Vault;
let writer: TrustedNoteWriter;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ks-tier1-'));
  const opened = await Vault.create(root);
  if (!opened.ok) throw opened.error;
  vault = opened.value;
  writer = new TrustedNoteWriter(vault, new RevisionStore(path.join(vault.appDir, 'history')));
});
afterEach(async () => { vault.close(); await rm(root, { recursive: true, force: true }); });

describe('Tier 1 integration', () => {
  it('clip → Base edit → PDF annotate/export → Zotero → MCP citations → integrity, with one ordered change feed', async () => {
    // 1. Web clip becomes a note with web provenance.
    const clip = await new WebClipperHost(writer).clip({ html: '<h1>Mangrove carbon</h1><p>Mangroves store blue carbon in sediment.</p>', url: 'https://example.org/mangroves' });
    if (!clip.ok) throw new Error(clip.error.message);

    // 2. A Base over clippings; inline status edit through the trusted metadata path.
    const bases = new BasesHost(writer);
    await bases.save({ schemaVersion: 1, id: 'reading', name: 'Reading queue', view: 'kanban', folder: 'Clippings', filters: [{ field: 'type', op: 'equals', value: 'web-clip' }], fields: ['status', 'source'], groupBy: 'status' }, undefined);
    const rows = await bases.query('reading');
    if (!rows.ok) throw new Error(rows.error.message);
    expect(rows.value.rows.map((row) => row.values['source'])).toEqual(['https://example.org/mangroves']);
    expect((await bases.setField({ path: clip.value.path, key: 'status', value: 'reading', expectedMtimeMs: rows.value.rows[0]!.mtimeMs })).ok).toBe(true);

    // 3. PDF highlight → literature note with page citation.
    await mkdir(path.join(root, 'papers'));
    await writeFile(path.join(root, 'papers', 'blue-carbon.pdf'), '%PDF-1.4\n');
    const pdf = new PdfHost(writer);
    const annotated = await pdf.add('papers/blue-carbon.pdf', { page: 5, quote: 'Sediment carbon persists for millennia', color: 'green' }, 0, 'Blue Carbon Review');
    if (!annotated.ok) throw new Error(annotated.error.message);
    const exported = await pdf.exportNote('papers/blue-carbon.pdf', 'Blue Carbon Review');
    if (!exported.ok) throw new Error(exported.error.message);

    // 4. Zotero sync adds a literature note.
    const zoteroResponse = JSON.stringify([{ key: 'MANG0001', data: { itemType: 'journalArticle', title: 'Mangrove sediment carbon', creators: [{ firstName: 'L', lastName: 'Nguyen' }], date: '2022', citationKey: 'nguyen2022' } }]);
    const fetchImpl: FetchLike = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(zoteroResponse) });
    const synced = await new ZoteroHost(writer, fetchImpl).syncLocal(23119);
    expect(synced.ok && synced.value.created).toBe(1);

    // 5. An externally created note and a copied note: integrity finds and repairs both.
    await writeFile(path.join(root, 'External.md'), '# External\n\nMangrove notes written outside the app.\n');
    await copyFile(path.join(root, exported.value.path), path.join(root, 'papers', 'copy.md'));
    const integrity = new IntegrityHost(writer);
    const report = await integrity.report();
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.missingId).toEqual(['External.md']);
    expect(report.value.duplicateIds).toHaveLength(1);
    expect(report.value.provenance.bySourceType).toEqual({ web: 1, pdf: 1, zotero: 1 });
    expect(report.value.provenance.unresolved).toEqual([]);
    const repaired = await integrity.repair();
    expect(repaired.ok && [repaired.value.assigned, repaired.value.reassigned, repaired.value.report.missingId.length, repaired.value.report.duplicateIds.length]).toEqual([1, 1, 0, 0]);

    // 6. MCP Retrieval V2 cites every source kind, and each citation resolves.
    const mcp = createVaultMcpDataSource(vault, { changeFeed: writer.feed, bases });
    const hits: readonly RetrievalHit[] = await mcp.retrieve('mangrove sediment carbon', 10);
    const paths = hits.map((hit) => hit.path);
    expect(paths).toEqual(expect.arrayContaining([clip.value.path, 'Literature/nguyen2022.md', exported.value.path, 'External.md']));
    for (const hit of hits) {
      expect(hit.sourceId).toMatch(new RegExp(`^ks:${vault.vaultId}:`));
      expect(await mcp.resolveCitation(hit.sourceId!)).toMatchObject({ resolution: { state: 'resolved', path: hit.path } });
    }
    expect(await mcp.resolveCitation(annotated.value.sourceId)).toMatchObject({ record: { sourceType: 'pdf' }, resolution: { state: 'resolved', path: 'papers/blue-carbon.pdf' } });
    const exportedNote = await readFile(path.join(root, exported.value.path), 'utf8');
    expect(exportedNote).toContain(`source_id: ${annotated.value.sourceId}`);

    // 7. The change feed is a single ordered log of every trusted producer.
    const feed = await mcp.listChanges(undefined, 100) as { changes: { sequence: number; type: string }[] };
    expect(feed.changes.map((change) => change.type)).toEqual(['source_imported', 'metadata_changed', 'annotation_created', 'document_created', 'source_imported', 'document_updated', 'document_updated']);
    expect(feed.changes.map((change) => change.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
