import { createId, err, isUuidV4, ok, type Result } from '@knowledge-studio/shared';
import type { Vault } from '@knowledge-studio/vault';

/**
 * PDF annotations (Phase 35). Annotations are user content, so they live in
 * the vault as a plain JSON sidecar next to the PDF
 * (`paper.pdf` → `paper.pdf.ks-annotations.json`); the PDF itself is never
 * modified. Each sidecar carries a stable `sourceKey` so citations survive
 * PDF renames when the sidecar moves with it.
 */

export const ANNOTATIONS_FORMAT = 'knowledge-studio.pdf-annotations' as const;
export const ANNOTATIONS_VERSION = 1 as const;
export const ANNOTATION_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export interface PdfAnnotation {
  readonly id: string;
  readonly page: number;
  readonly quote: string;
  readonly color: AnnotationColor;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnnotationFile {
  readonly format: typeof ANNOTATIONS_FORMAT;
  readonly schemaVersion: typeof ANNOTATIONS_VERSION;
  readonly pdfPath: string;
  readonly sourceKey: string;
  readonly revision: number;
  readonly annotations: readonly PdfAnnotation[];
}

export type AnnotationError = {
  readonly code:
    | 'ANNOTATION_INVALID'
    | 'ANNOTATION_NOT_FOUND'
    | 'ANNOTATION_CONFLICT'
    | 'ANNOTATION_FILE_INVALID'
    | 'PDF_PATH_INVALID';
  readonly message: string;
};
export interface NewAnnotation {
  readonly page: number;
  readonly quote: string;
  readonly color: AnnotationColor;
  readonly note?: string;
}
export interface AnnotationPatch {
  readonly color?: AnnotationColor;
  readonly note?: string;
}

const MAX_QUOTE = 4000;
const MAX_NOTE = 10_000;
const MAX_PAGE = 100_000;

export function sidecarPath(pdfPath: string): string {
  return `${pdfPath}.ks-annotations.json`;
}

export function isPdfPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 4 &&
    value.length <= 1024 &&
    /\.pdf$/i.test(value) &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !value.split('/').includes('..')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isColor(value: unknown): value is AnnotationColor {
  return typeof value === 'string' && (ANNOTATION_COLORS as readonly string[]).includes(value);
}

export function parseNewAnnotation(value: unknown): Result<NewAnnotation, AnnotationError> {
  const bad = (message: string): Result<never, AnnotationError> =>
    err({ code: 'ANNOTATION_INVALID', message });
  if (!isRecord(value)) return bad('Annotation must be an object');
  const { page, quote, color, note } = value;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > MAX_PAGE)
    return bad('Page must be a positive integer');
  if (typeof quote !== 'string' || quote.trim().length === 0 || quote.length > MAX_QUOTE)
    return bad(`Quote must be 1-${MAX_QUOTE} characters`);
  if (!isColor(color)) return bad('Color is invalid');
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE))
    return bad('Note is too long');
  return ok({
    page,
    quote: quote.replace(/\s+/g, ' ').trim(),
    color,
    ...(typeof note === 'string' && note.trim() ? { note: note.trim() } : {}),
  });
}

export function parseAnnotationPatch(value: unknown): Result<AnnotationPatch, AnnotationError> {
  if (!isRecord(value))
    return err({ code: 'ANNOTATION_INVALID', message: 'Patch must be an object' });
  const { color, note } = value;
  if (color !== undefined && !isColor(color))
    return err({ code: 'ANNOTATION_INVALID', message: 'Color is invalid' });
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE))
    return err({ code: 'ANNOTATION_INVALID', message: 'Note is too long' });
  return ok({ ...(color !== undefined ? { color } : {}), ...(note !== undefined ? { note } : {}) });
}

function validFile(value: unknown, pdfPath: string): value is AnnotationFile {
  if (
    !isRecord(value) ||
    value['format'] !== ANNOTATIONS_FORMAT ||
    value['schemaVersion'] !== ANNOTATIONS_VERSION ||
    value['pdfPath'] !== pdfPath
  )
    return false;
  if (
    !isUuidV4(value['sourceKey']) ||
    !Number.isInteger(value['revision']) ||
    !Array.isArray(value['annotations'])
  )
    return false;
  return value['annotations'].every(
    (annotation) =>
      isRecord(annotation) &&
      isUuidV4(annotation['id']) &&
      parseNewAnnotation(annotation).ok &&
      typeof annotation['createdAt'] === 'string' &&
      typeof annotation['updatedAt'] === 'string',
  );
}

export class PdfAnnotationStore {
  constructor(private readonly vault: Vault) {}

  /** Loads a sidecar; a missing sidecar is an empty, not-yet-persisted file. */
  async load(pdfPath: string): Promise<Result<AnnotationFile, AnnotationError>> {
    if (!isPdfPath(pdfPath))
      return err({ code: 'PDF_PATH_INVALID', message: 'Path must be a vault-relative PDF' });
    const read = await this.vault.readFile(sidecarPath(pdfPath));
    if (!read.ok) {
      if (read.error.code === 'VAULT_PATH_NOT_FOUND')
        return ok({
          format: ANNOTATIONS_FORMAT,
          schemaVersion: ANNOTATIONS_VERSION,
          pdfPath,
          sourceKey: createId(),
          revision: 0,
          annotations: [],
        });
      return err({ code: 'ANNOTATION_FILE_INVALID', message: read.error.message });
    }
    try {
      const parsed: unknown = JSON.parse(read.value.content);
      return validFile(parsed, pdfPath)
        ? ok(parsed)
        : err({
            code: 'ANNOTATION_FILE_INVALID',
            message: 'Annotation sidecar is invalid or unsupported',
          });
    } catch {
      return err({
        code: 'ANNOTATION_FILE_INVALID',
        message: 'Annotation sidecar cannot be parsed',
      });
    }
  }

  private async save(
    file: AnnotationFile,
    expectedRevision: number,
    annotations: readonly PdfAnnotation[],
  ): Promise<Result<AnnotationFile, AnnotationError>> {
    if (file.revision !== expectedRevision)
      return err({ code: 'ANNOTATION_CONFLICT', message: 'Annotations changed; reload and retry' });
    const next: AnnotationFile = {
      ...file,
      revision: file.revision + 1,
      annotations: [...annotations].sort(
        (a, b) => a.page - b.page || a.createdAt.localeCompare(b.createdAt),
      ),
    };
    const written = await this.vault.writeFile(
      sidecarPath(file.pdfPath),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    return written.ok
      ? ok(next)
      : err({ code: 'ANNOTATION_FILE_INVALID', message: written.error.message });
  }

  async add(
    pdfPath: string,
    input: NewAnnotation,
    expectedRevision: number,
    now = new Date(),
  ): Promise<Result<{ file: AnnotationFile; annotation: PdfAnnotation }, AnnotationError>> {
    const file = await this.load(pdfPath);
    if (!file.ok) return file;
    const stamp = now.toISOString();
    const annotation: PdfAnnotation = {
      id: createId(),
      ...input,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const saved = await this.save(file.value, expectedRevision, [
      ...file.value.annotations,
      annotation,
    ]);
    return saved.ok ? ok({ file: saved.value, annotation }) : saved;
  }

  async update(
    pdfPath: string,
    id: string,
    patch: AnnotationPatch,
    expectedRevision: number,
    now = new Date(),
  ): Promise<Result<{ file: AnnotationFile; annotation: PdfAnnotation }, AnnotationError>> {
    const file = await this.load(pdfPath);
    if (!file.ok) return file;
    const current = file.value.annotations.find((annotation) => annotation.id === id);
    if (!current) return err({ code: 'ANNOTATION_NOT_FOUND', message: 'Annotation was not found' });
    const { note: _previousNote, ...rest } = current;
    const note = patch.note !== undefined ? patch.note.trim() : current.note;
    const annotation: PdfAnnotation = {
      ...rest,
      ...(patch.color ? { color: patch.color } : {}),
      ...(note ? { note } : {}),
      updatedAt: now.toISOString(),
    };
    const saved = await this.save(
      file.value,
      expectedRevision,
      file.value.annotations.map((entry) => (entry.id === id ? annotation : entry)),
    );
    return saved.ok ? ok({ file: saved.value, annotation }) : saved;
  }

  async remove(
    pdfPath: string,
    id: string,
    expectedRevision: number,
  ): Promise<Result<AnnotationFile, AnnotationError>> {
    const file = await this.load(pdfPath);
    if (!file.ok) return file;
    if (!file.value.annotations.some((annotation) => annotation.id === id))
      return err({ code: 'ANNOTATION_NOT_FOUND', message: 'Annotation was not found' });
    return this.save(
      file.value,
      expectedRevision,
      file.value.annotations.filter((annotation) => annotation.id !== id),
    );
  }
}

/** Markdown export: quotes with page citations, suitable for a literature note. */
export function annotationsToMarkdown(
  title: string,
  pdfPath: string,
  file: AnnotationFile,
  sourceId: string,
): string {
  const escapeQuote = (text: string): string => text.replace(/([\\`*_[\]<>|])/g, '\\$1');
  const lines = [
    `# ${title} — annotations`,
    '',
    `Source: [${pdfPath}](<${pdfPath}>) · \`${sourceId}\``,
    '',
  ];
  for (const annotation of file.annotations) {
    lines.push(`> ${escapeQuote(annotation.quote)}`, `> — ${title}, p. ${annotation.page}`, '');
    if (annotation.note) lines.push(escapeQuote(annotation.note), '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
