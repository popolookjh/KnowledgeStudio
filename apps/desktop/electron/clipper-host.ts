import fs from 'node:fs/promises';
import path from 'node:path';
import { ProvenanceStore } from '@knowledge-studio/provenance';
import { createId, sourceIdFor } from '@knowledge-studio/shared';
import {
  buildClipNote,
  clipNotePath,
  extractClip,
  MAX_CLIP_BYTES,
  parseClipInput,
} from '@knowledge-studio/web-clipper';
import type { ClipResultDto, RpcResult } from '../shared/ipc-contract.js';
import type { TrustedNoteWriter } from './trusted-note-writer.js';

/**
 * Trusted web clip ingestion. Content arrives as user-provided HTML/text
 * (paste or a user-picked saved page); the source URL is metadata only and
 * is never fetched. Notes are written through the TrustedNoteWriter
 * (identity, history, change feed) and a `web` provenance record is stored.
 */
export class WebClipperHost {
  private readonly provenance: ProvenanceStore;

  constructor(private readonly writer: TrustedNoteWriter) {
    this.provenance = new ProvenanceStore(writer.vault);
  }

  async clip(input: unknown, now = new Date()): Promise<RpcResult<ClipResultDto>> {
    const parsed = parseClipInput(input);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const clip = extractClip(parsed.value);
    if (!clip.ok) return { ok: false, error: clip.error };
    const note = buildClipNote(clip.value, now);
    if (!note.ok) return { ok: false, error: note.error };
    const taken = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = clipNotePath(clip.value.title, (vaultPath) => taken.has(vaultPath));
      const exists = await this.writer.vault.exists(candidate);
      if (exists.ok && exists.value) {
        taken.add(candidate);
        continue;
      }
      const written = await this.writer.write(candidate, note.value, {
        createOnly: true,
        changeType: 'source_imported',
        changeMetadata: { sourceType: 'web', ...(clip.value.url ? { url: clip.value.url } : {}) },
      });
      if (!written.ok) {
        if (written.error.code === 'VAULT_PATH_EXISTS') {
          taken.add(candidate);
          continue;
        }
        return written;
      }
      const documentId = written.value.documentId!;
      const sourceId = sourceIdFor(this.writer.vault.vaultId, documentId);
      const recorded = await this.provenance.upsert({
        id: createId(),
        sourceId,
        documentId,
        sourceType: 'web',
        origin: 'external',
        title: clip.value.title,
        ...(clip.value.url ? { url: clip.value.url } : {}),
        localRef: candidate,
        importedAt: now.toISOString(),
        state: 'available',
      });
      if (!recorded.ok) return { ok: false, error: recorded.error };
      return {
        ok: true,
        value: {
          path: candidate,
          title: clip.value.title,
          documentId,
          sourceId,
          url: clip.value.url,
        },
      };
    }
    return {
      ok: false,
      error: { code: 'VAULT_PATH_EXISTS', message: 'Could not choose a unique clip filename' },
    };
  }

  /** Imports a user-picked saved page (.html/.htm/.txt) from disk. */
  async clipFile(filePath: string, now = new Date()): Promise<RpcResult<ClipResultDto>> {
    if (!/\.(html?|txt)$/i.test(filePath))
      return {
        ok: false,
        error: { code: 'CLIP_INVALID', message: 'Choose an .html, .htm, or .txt file' },
      };
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile())
      return { ok: false, error: { code: 'CLIP_INVALID', message: 'Saved page was not found' } };
    if (stat.size > MAX_CLIP_BYTES)
      return { ok: false, error: { code: 'CLIP_TOO_LARGE', message: 'Clip exceeds 5 MB' } };
    const html = await fs.readFile(filePath, 'utf8');
    return this.clip(
      {
        html,
        ...(/\.txt$/i.test(filePath)
          ? { title: path.basename(filePath).replace(/\.txt$/i, '') }
          : {}),
      },
      now,
    );
  }
}
