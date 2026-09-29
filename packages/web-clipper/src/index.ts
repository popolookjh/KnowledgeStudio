import { writeMetadata } from '@knowledge-studio/metadata';
import { classifyLink } from '@knowledge-studio/security';
import { err, ok, type Result } from '@knowledge-studio/shared';
import { decodeEntities, htmlToMarkdown } from './html.js';

export { decodeEntities, htmlToMarkdown, safeHref, type HtmlExtraction } from './html.js';

/**
 * Web clip ingestion (Phase 34). Clips arrive as user-supplied HTML or text
 * (paste or a saved page); URLs are recorded as provenance metadata only and
 * are never fetched. Output is a plain Markdown note.
 */

export const MAX_CLIP_BYTES = 5 * 1024 * 1024;
export const CLIPPINGS_FOLDER = 'Clippings';

export interface ClipInput { readonly html: string; readonly url?: string; readonly title?: string; readonly tags?: readonly string[]; }
export interface ClipDocument { readonly title: string; readonly url: string | null; readonly siteName: string | null; readonly markdown: string; readonly tags: readonly string[]; }
export type ClipError = { readonly code: 'CLIP_INVALID' | 'CLIP_TOO_LARGE' | 'CLIP_EMPTY'; readonly message: string };

const TAG = /^[\p{L}\p{N}_/-]{1,64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Runtime validation for clip requests arriving from the renderer. */
export function parseClipInput(value: unknown): Result<ClipInput, ClipError> {
  if (!isRecord(value)) return err({ code: 'CLIP_INVALID', message: 'Clip must be an object' });
  const { html, url, title, tags } = value;
  if (typeof html !== 'string') return err({ code: 'CLIP_INVALID', message: 'Clip content must be text' });
  if (Buffer.byteLength(html, 'utf8') > MAX_CLIP_BYTES) return err({ code: 'CLIP_TOO_LARGE', message: 'Clip exceeds 5 MB' });
  if (url !== undefined && url !== '' && (typeof url !== 'string' || url.length > 2048 || classifyLink(url) !== 'safe-external')) return err({ code: 'CLIP_INVALID', message: 'Source URL must be http(s)' });
  if (title !== undefined && (typeof title !== 'string' || title.length > 300)) return err({ code: 'CLIP_INVALID', message: 'Title is invalid' });
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 16 || !tags.every((tag) => typeof tag === 'string' && TAG.test(tag)))) return err({ code: 'CLIP_INVALID', message: 'Tags are invalid' });
  return ok({ html, ...(typeof url === 'string' && url !== '' ? { url } : {}), ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}), ...(tags ? { tags: tags as string[] } : {}) });
}

function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i.test(text);
}

/** Converts a clip to a normalized document; plain text is kept as paragraphs. */
export function extractClip(input: ClipInput): Result<ClipDocument, ClipError> {
  const extraction = looksLikeHtml(input.html)
    ? htmlToMarkdown(input.html, input.url)
    : { markdown: decodeEntities(input.html).replace(/\r\n?/g, '\n').replace(/([\\`*_[\]<>|])/g, '\\$1').trim(), title: null, canonicalUrl: null, siteName: null };
  if (extraction.markdown.length === 0) return err({ code: 'CLIP_EMPTY', message: 'Clip has no readable content' });
  const title = (input.title ?? extraction.title ?? extraction.markdown.split('\n')[0]!.replace(/^#+\s*/, '').slice(0, 120)).trim() || 'Web clip';
  return ok({ title, url: input.url ?? extraction.canonicalUrl, siteName: extraction.siteName, markdown: extraction.markdown, tags: [...new Set(['clipping', ...(input.tags ?? [])])] });
}

/** Builds the note: typed frontmatter (source URL as metadata) + Markdown body. */
export function buildClipNote(clip: ClipDocument, clippedAt: Date): Result<string, ClipError> {
  const header = clip.url ? `> Clipped from <${clip.url}>\n\n` : '';
  const written = writeMetadata(`# ${clip.title}\n\n${header}${clip.markdown}\n`, {
    title: clip.title,
    type: 'web-clip',
    tags: clip.tags,
    ...(clip.url ? { source: clip.url } : {}),
    ...(clip.siteName ? { site: clip.siteName } : {}),
    clipped: clippedAt.toISOString(),
  });
  return written.ok ? ok(written.value) : err({ code: 'CLIP_INVALID', message: written.error.map((issue) => issue.message).join('; ') });
}

/** Windows/Unicode-safe note filename under Clippings/, unique against `exists`. */
export function clipNotePath(title: string, exists: (vaultPath: string) => boolean): string {
  const stem = title
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows filenames
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 80) || 'Web clip';
  const safeStem = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? `${stem} clip` : stem;
  let candidate = `${CLIPPINGS_FOLDER}/${safeStem}.md`;
  for (let counter = 2; exists(candidate) && counter < 1000; counter += 1) candidate = `${CLIPPINGS_FOLDER}/${safeStem} ${counter}.md`;
  return candidate;
}
