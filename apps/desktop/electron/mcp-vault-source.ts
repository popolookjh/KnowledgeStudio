import type { ChangeFeedStore } from '@knowledge-studio/change-feed';
import { extractOutgoingLinks } from '@knowledge-studio/links';
import {
  chunkMarkdown,
  scoreChunks,
  type McpDataSource,
  type NoteRecord,
  type RetrievalHit,
} from '@knowledge-studio/mcp';
import { readMetadata } from '@knowledge-studio/metadata';
import { isPdfPath, PdfAnnotationStore } from '@knowledge-studio/pdf-annotations';
import { ProvenanceStore, renderCompactCitation } from '@knowledge-studio/provenance';
import { sourceIdFor } from '@knowledge-studio/shared';
import { extractTags } from '@knowledge-studio/tags';
import { walkVault, type Vault } from '@knowledge-studio/vault';
import type { BasesHost } from './bases-host.js';

export interface McpSourceDependencies {
  /** FTS5 candidate paths, best first; returns null when the index is unavailable. */
  readonly searchPaths?: (query: string, limit: number) => readonly string[] | null;
  readonly changeFeed?: ChangeFeedStore;
  readonly bases?: BasesHost;
}

/** Active-vault read-only adapter for the MCP host (Retrieval V2). */
export function createVaultMcpDataSource(
  vault: Vault,
  deps: McpSourceDependencies = {},
): McpDataSource {
  const toRecord = (notePath: string, content: string): NoteRecord => {
    const metadata = readMetadata(content).data;
    const documentId = typeof metadata.id === 'string' ? metadata.id : null;
    return {
      path: notePath,
      content,
      metadata,
      documentId,
      sourceId: documentId ? sourceIdFor(vault.vaultId, documentId) : null,
    };
  };
  const notes = async (): Promise<readonly NoteRecord[]> => {
    const entries = await walkVault(vault.root);
    if (!entries.ok) return [];
    const records: NoteRecord[] = [];
    for (const entry of entries.value) {
      if (entry.kind !== 'note') continue;
      const read = await vault.readFile(entry.path);
      if (read.ok) records.push(toRecord(entry.path, read.value.content));
    }
    return records;
  };
  const provenance = new ProvenanceStore(vault);
  const annotations = new PdfAnnotationStore(vault);

  return {
    async searchNotes(query) {
      const needle = query.toLocaleLowerCase();
      return (await notes()).filter(
        (note) =>
          note.path.toLocaleLowerCase().includes(needle) ||
          note.content.toLocaleLowerCase().includes(needle),
      );
    },
    async readNote(notePath) {
      const read = await vault.readFile(notePath);
      return read.ok ? toRecord(notePath, read.value.content) : null;
    },
    async listNotes() {
      return notes();
    },
    async getMetadata(notePath) {
      const read = await vault.readFile(notePath);
      return read.ok ? readMetadata(read.value.content).data : null;
    },
    async getBacklinks(notePath) {
      const result: string[] = [];
      for (const note of await notes()) {
        if (
          extractOutgoingLinks(note.content).wiki.some(
            (link) => link.target === notePath || `${link.target}.md` === notePath,
          )
        )
          result.push(note.path);
      }
      return result;
    },
    async getOutgoingLinks(notePath) {
      const read = await vault.readFile(notePath);
      if (!read.ok) return [];
      const outgoing = extractOutgoingLinks(read.value.content);
      return [
        ...outgoing.wiki.map((link) => link.target),
        ...outgoing.markdown.map((link) => link.href),
      ];
    },
    async searchTags(tag) {
      const needle = tag.replace(/^#/, '').toLocaleLowerCase();
      return (await notes())
        .filter((note) => extractTags(note.content).some((entry) => entry.tag === needle))
        .map((note) => note.path);
    },

    async retrieve(query, limit) {
      // Candidates come from the FTS5 index when available (fast path), else a full scan.
      const candidatePaths = deps.searchPaths?.(query, Math.max(limit * 3, 20));
      const candidates: NoteRecord[] = [];
      if (candidatePaths && candidatePaths.length > 0) {
        for (const candidate of candidatePaths) {
          const read = await vault.readFile(candidate);
          if (read.ok) candidates.push(toRecord(candidate, read.value.content));
        }
      } else candidates.push(...(await notes()));
      const hits: RetrievalHit[] = [];
      for (const note of candidates) {
        const best = scoreChunks(chunkMarkdown(note.content), query)[0];
        if (!best) continue;
        const title =
          typeof note.metadata?.['title'] === 'string'
            ? note.metadata['title']
            : note.path.replace(/^.*\//, '').replace(/\.md$/, '');
        const chunkId = `${note.documentId ?? note.path}#c${best.index}`;
        const citation = renderCompactCitation({
          id: chunkId,
          sourceId: note.sourceId ?? note.path,
          sourceType: 'markdown',
          origin: 'local',
          title,
          ...(best.heading ? { locator: { heading: best.heading } } : {}),
        });
        hits.push({
          path: note.path,
          title,
          documentId: note.documentId ?? null,
          sourceId: note.sourceId ?? null,
          score: best.score,
          passage: best.text.slice(0, 800),
          locator: { ...(best.heading ? { heading: best.heading } : {}), chunkId },
          citation,
        });
      }
      return hits
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path, 'en'))
        .slice(0, limit);
    },

    async resolveCitation(sourceId) {
      const loaded = await provenance.load();
      const record = loaded.ok
        ? (loaded.value.records.find((entry) => entry.sourceId === sourceId) ?? null)
        : null;
      if (record && !record.documentId && record.localRef) {
        const exists = await vault.exists(record.localRef);
        return {
          sourceId,
          record,
          resolution: {
            state: exists.ok && exists.value ? 'resolved' : 'missing',
            path: record.localRef,
          },
        };
      }
      const resolution = await provenance.resolveSourceProvenance(sourceId);
      return {
        sourceId,
        record,
        resolution: resolution.ok
          ? resolution.value
          : { state: 'invalid', error: resolution.error.code },
      };
    },

    async listChanges(cursor, limit) {
      if (!deps.changeFeed) return { error: 'CHANGE_FEED_UNAVAILABLE' };
      const page = await deps.changeFeed.changesSince(cursor, limit);
      return page.ok ? page.value : { error: page.error.code, message: page.error.message };
    },

    async listAnnotations(pdfPath) {
      if (!isPdfPath(pdfPath)) return { error: 'PDF_PATH_INVALID' };
      const file = await annotations.load(pdfPath);
      if (!file.ok) return { error: file.error.code };
      const sourceId =
        file.value.revision > 0 ? sourceIdFor(vault.vaultId, file.value.sourceKey) : null;
      return {
        pdfPath,
        sourceId,
        annotations: file.value.annotations.map((annotation) => ({
          ...annotation,
          citation: `${pdfPath.replace(/^.*\//, '')}, p. ${annotation.page}`,
        })),
      };
    },

    async queryBase(baseId) {
      if (!deps.bases) return { error: 'BASES_UNAVAILABLE' };
      const result = await deps.bases.query(baseId);
      return result.ok
        ? { base: result.value.base.definition, total: result.value.total, rows: result.value.rows }
        : { error: result.error.code, message: result.error.message };
    },
  };
}
