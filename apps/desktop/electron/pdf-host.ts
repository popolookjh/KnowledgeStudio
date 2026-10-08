import { writeMetadata } from '@knowledge-studio/metadata';
import { annotationsToMarkdown, isPdfPath, parseAnnotationPatch, parseNewAnnotation, PdfAnnotationStore, type AnnotationFile } from '@knowledge-studio/pdf-annotations';
import { ProvenanceStore } from '@knowledge-studio/provenance';
import { sourceIdFor } from '@knowledge-studio/shared';
import type { PdfAnnotationsDto, PdfDocumentDto, RpcResult } from '../shared/ipc-contract.js';
import type { TrustedNoteWriter } from './trusted-note-writer.js';
import { serializeFailure } from './trusted-note-writer.js';

export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/**
 * Trusted PDF host (Phase 35). Reads vault PDFs as bytes for the renderer's
 * sandboxed pdf.js (no file paths or fs authority cross the bridge), and
 * owns annotation persistence, `pdf` provenance registration, change-feed
 * events, and Markdown export through the TrustedNoteWriter.
 */
export class PdfHost {
  private readonly annotations: PdfAnnotationStore;
  private readonly provenance: ProvenanceStore;

  constructor(private readonly writer: TrustedNoteWriter) {
    this.annotations = new PdfAnnotationStore(writer.vault);
    this.provenance = new ProvenanceStore(writer.vault);
  }

  private dto(file: AnnotationFile): PdfAnnotationsDto {
    return { pdfPath: file.pdfPath, sourceId: sourceIdFor(this.writer.vault.vaultId, file.sourceKey), revision: file.revision, annotations: file.annotations };
  }

  async read(pdfPath: unknown): Promise<RpcResult<PdfDocumentDto>> {
    if (!isPdfPath(pdfPath)) return { ok: false, error: { code: 'PDF_PATH_INVALID', message: 'Path must be a vault-relative PDF' } };
    const read = await this.writer.vault.readBinary(pdfPath);
    if (!read.ok) return { ok: false, error: serializeFailure(read.error) };
    if (read.value.size > MAX_PDF_BYTES) return { ok: false, error: { code: 'PDF_TOO_LARGE', message: 'PDF exceeds 100 MB' } };
    if (Buffer.from(read.value.bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return { ok: false, error: { code: 'PDF_INVALID', message: 'File is not a PDF' } };
    return { ok: true, value: { path: pdfPath, bytes: new Uint8Array(read.value.bytes), size: read.value.size } };
  }

  async list(pdfPath: unknown): Promise<RpcResult<PdfAnnotationsDto>> {
    if (!isPdfPath(pdfPath)) return { ok: false, error: { code: 'PDF_PATH_INVALID', message: 'Path must be a vault-relative PDF' } };
    const loaded = await this.annotations.load(pdfPath);
    return loaded.ok ? { ok: true, value: this.dto(loaded.value) } : { ok: false, error: loaded.error };
  }

  private async registerSource(file: AnnotationFile, title: string | undefined): Promise<void> {
    const sourceId = sourceIdFor(this.writer.vault.vaultId, file.sourceKey);
    const existing = await this.provenance.load();
    if (existing.ok && existing.value.records.some((record) => record.id === file.sourceKey && record.localRef === file.pdfPath)) return;
    await this.provenance.upsert({ id: file.sourceKey, sourceId, sourceType: 'pdf', origin: 'local', localRef: file.pdfPath, title: title ?? file.pdfPath.replace(/^.*\//, '').replace(/\.pdf$/i, ''), importedAt: new Date().toISOString(), state: 'available' });
  }

  async add(pdfPath: unknown, input: unknown, expectedRevision: unknown, title?: unknown): Promise<RpcResult<PdfAnnotationsDto>> {
    if (!isPdfPath(pdfPath) || typeof expectedRevision !== 'number') return { ok: false, error: { code: 'ANNOTATION_INVALID', message: 'PDF path or revision is invalid' } };
    const parsed = parseNewAnnotation(input);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const pdf = await this.writer.vault.exists(pdfPath);
    if (!pdf.ok || !pdf.value) return { ok: false, error: { code: 'VAULT_PATH_NOT_FOUND', message: 'PDF was not found' } };
    const added = await this.annotations.add(pdfPath, parsed.value, expectedRevision);
    if (!added.ok) return { ok: false, error: added.error };
    await this.registerSource(added.value.file, typeof title === 'string' && title.trim() ? title.trim().slice(0, 300) : undefined);
    await this.writer.recordChange({ type: 'annotation_created', entityId: added.value.annotation.id, path: pdfPath, sourceId: sourceIdFor(this.writer.vault.vaultId, added.value.file.sourceKey), metadata: { page: added.value.annotation.page } });
    return { ok: true, value: this.dto(added.value.file) };
  }

  async update(pdfPath: unknown, id: unknown, patch: unknown, expectedRevision: unknown): Promise<RpcResult<PdfAnnotationsDto>> {
    if (!isPdfPath(pdfPath) || typeof id !== 'string' || typeof expectedRevision !== 'number') return { ok: false, error: { code: 'ANNOTATION_INVALID', message: 'Annotation reference is invalid' } };
    const parsed = parseAnnotationPatch(patch);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const updated = await this.annotations.update(pdfPath, id, parsed.value, expectedRevision);
    if (!updated.ok) return { ok: false, error: updated.error };
    await this.writer.recordChange({ type: 'annotation_updated', entityId: id, path: pdfPath, sourceId: sourceIdFor(this.writer.vault.vaultId, updated.value.file.sourceKey) });
    return { ok: true, value: this.dto(updated.value.file) };
  }

  async remove(pdfPath: unknown, id: unknown, expectedRevision: unknown): Promise<RpcResult<PdfAnnotationsDto>> {
    if (!isPdfPath(pdfPath) || typeof id !== 'string' || typeof expectedRevision !== 'number') return { ok: false, error: { code: 'ANNOTATION_INVALID', message: 'Annotation reference is invalid' } };
    const removed = await this.annotations.remove(pdfPath, id, expectedRevision);
    if (!removed.ok) return { ok: false, error: removed.error };
    await this.writer.recordChange({ type: 'annotation_deleted', entityId: id, path: pdfPath, sourceId: sourceIdFor(this.writer.vault.vaultId, removed.value.sourceKey) });
    return { ok: true, value: this.dto(removed.value) };
  }

  /** Writes a new literature note with all annotations as cited quotes. */
  async exportNote(pdfPath: unknown, title: unknown): Promise<RpcResult<{ path: string }>> {
    if (!isPdfPath(pdfPath)) return { ok: false, error: { code: 'PDF_PATH_INVALID', message: 'Path must be a vault-relative PDF' } };
    const loaded = await this.annotations.load(pdfPath);
    if (!loaded.ok) return { ok: false, error: loaded.error };
    if (loaded.value.annotations.length === 0) return { ok: false, error: { code: 'ANNOTATION_NOT_FOUND', message: 'There are no annotations to export' } };
    const displayTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : pdfPath.replace(/^.*\//, '').replace(/\.pdf$/i, '');
    const sourceId = sourceIdFor(this.writer.vault.vaultId, loaded.value.sourceKey);
    const body = annotationsToMarkdown(displayTitle, pdfPath, loaded.value, sourceId);
    const content = writeMetadata(body, { title: `${displayTitle} — annotations`, type: 'pdf-annotations', source: pdfPath, source_id: sourceId, tags: ['annotations'] });
    if (!content.ok) return { ok: false, error: { code: 'METADATA_INVALID', message: content.error.map((issue) => issue.message).join('; ') } };
    const base = pdfPath.replace(/\.pdf$/i, '');
    for (let counter = 1; counter < 100; counter += 1) {
      const candidate = `${base} annotations${counter === 1 ? '' : ` ${counter}`}.md`;
      const written = await this.writer.write(candidate, content.value, { createOnly: true, changeMetadata: { derivedFrom: sourceId } });
      if (written.ok) return { ok: true, value: { path: candidate } };
      if (written.error.code !== 'VAULT_PATH_EXISTS') return written;
    }
    return { ok: false, error: { code: 'VAULT_PATH_EXISTS', message: 'Could not choose a unique note name' } };
  }
}
