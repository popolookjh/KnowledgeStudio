import { writeMetadata } from '@knowledge-studio/metadata';
import { err, ok, type Result } from '@knowledge-studio/shared';

/**
 * Zotero integration (Phase 37). Two offline-first inputs:
 *  - exported CSL-JSON or BibTeX files (no network at all), and
 *  - the Zotero 7 desktop *local* API, which is contacted only on
 *    127.0.0.1 when the user explicitly syncs (read-only GET, no keys).
 * Items become plain Markdown literature notes; nothing here writes files.
 */

export interface ZoteroItem {
  readonly key: string;
  readonly itemType: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly year?: number;
  readonly citationKey?: string;
  readonly doi?: string;
  readonly url?: string;
  readonly abstract?: string;
  readonly container?: string;
  readonly tags: readonly string[];
}

export type ZoteroError = { readonly code: 'ZOTERO_PARSE_FAILED' | 'ZOTERO_UNAVAILABLE' | 'ZOTERO_INVALID'; readonly message: string };

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_ITEMS = 5000;
export const ZOTERO_DEFAULT_PORT = 23119;

const clean = (value: unknown, max = 2000): string | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, max) : undefined;
};
const safeUrl = (value: unknown): string | undefined => {
  const text = clean(value, 2048);
  return text && /^https?:\/\//i.test(text) ? text : undefined;
};
const yearOf = (value: unknown): number | undefined => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const match = /\b(1[5-9]\d\d|2\d\d\d)\b/.exec(text);
  return match ? Number(match[1]) : undefined;
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const safeKey = (value: unknown): string | undefined => {
  const text = clean(value, 128);
  return text && /^[\p{L}\p{N}_:.\-/]+$/u.test(text) ? text : undefined;
};

function build(fields: { key?: string; itemType?: string; title?: string; authors: string[]; year?: number; citationKey?: string; doi?: string; url?: string; abstract?: string; container?: string; tags: string[] }): ZoteroItem | null {
  if (!fields.key || !fields.title) return null;
  return {
    key: fields.key,
    itemType: fields.itemType ?? 'document',
    title: fields.title,
    authors: fields.authors.slice(0, 100),
    tags: [...new Set(fields.tags.map((tag) => tag.replace(/\s+/g, '-')).filter((tag) => /^[\p{L}\p{N}_/-]{1,64}$/u.test(tag)))].slice(0, 32),
    ...(fields.year ? { year: fields.year } : {}),
    ...(fields.citationKey ? { citationKey: fields.citationKey } : {}),
    ...(fields.doi ? { doi: fields.doi } : {}),
    ...(fields.url ? { url: fields.url } : {}),
    ...(fields.abstract ? { abstract: fields.abstract } : {}),
    ...(fields.container ? { container: fields.container } : {}),
  };
}

/** CSL-JSON (Zotero "Export → CSL JSON" or Better BibTeX). */
export function parseCslJson(text: string): Result<readonly ZoteroItem[], ZoteroError> {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return err({ code: 'ZOTERO_PARSE_FAILED', message: 'CSL JSON cannot be parsed' }); }
  const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed['items']) ? parsed['items'] : null;
  if (!list) return err({ code: 'ZOTERO_PARSE_FAILED', message: 'CSL JSON must be an array of items' });
  const items: ZoteroItem[] = [];
  for (const raw of list.slice(0, MAX_ITEMS)) {
    if (!isRecord(raw)) continue;
    const authors = Array.isArray(raw['author']) ? raw['author'].filter(isRecord).map((author) => clean(author['literal'], 200) ?? [clean(author['given'], 100), clean(author['family'], 100)].filter(Boolean).join(' ')).filter((name) => name.length > 0) : [];
    const issued = isRecord(raw['issued']) && Array.isArray(raw['issued']['date-parts']) ? JSON.stringify(raw['issued']['date-parts']) : raw['issued'];
    const item = build({ key: safeKey(raw['id']), itemType: clean(raw['type'], 64), title: clean(raw['title'], 500), authors, year: yearOf(issued), citationKey: safeKey(raw['citation-key'] ?? raw['citationKey'] ?? raw['id']), doi: clean(raw['DOI'], 256), url: safeUrl(raw['URL']), abstract: clean(raw['abstract'], 5000), container: clean(raw['container-title'], 300), tags: typeof raw['keyword'] === 'string' ? raw['keyword'].split(/[,;]/).map((tag) => tag.trim()) : [] });
    if (item) items.push(item);
  }
  return ok(items);
}

/** Minimal, non-evaluating BibTeX parser for `@type{key, field = {..} | ".." | 123}` entries. */
export function parseBibtex(text: string): Result<readonly ZoteroItem[], ZoteroError> {
  const items: ZoteroItem[] = [];
  const entry = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = entry.exec(text)) !== null && items.length < MAX_ITEMS) {
    const type = match[1]!.toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const fields: Record<string, string> = {};
    let index = entry.lastIndex;
    while (index < text.length) {
      const fieldMatch = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
      fieldMatch.lastIndex = index;
      const found = fieldMatch.exec(text);
      if (!found) break;
      index = fieldMatch.lastIndex;
      let value = '';
      if (text[index] === '{') {
        let depth = 0;
        const start = index + 1;
        for (; index < text.length; index += 1) {
          if (text[index] === '{') depth += 1;
          else if (text[index] === '}') { depth -= 1; if (depth === 0) break; }
        }
        value = text.slice(start, index);
        index += 1;
      } else if (text[index] === '"') {
        const end = text.indexOf('"', index + 1);
        if (end === -1) return err({ code: 'ZOTERO_PARSE_FAILED', message: 'Unterminated BibTeX string' });
        value = text.slice(index + 1, end);
        index = end + 1;
      } else {
        const bare = /[\w.-]+/y;
        bare.lastIndex = index;
        const token = bare.exec(text);
        value = token?.[0] ?? '';
        index = bare.lastIndex || index;
      }
      fields[found[1]!.toLowerCase()] = value.replace(/[{}]/g, '').replace(/\\&/g, '&');
      const separator = /\s*(,|\})/y;
      separator.lastIndex = index;
      const sep = separator.exec(text);
      if (!sep) break;
      index = separator.lastIndex;
      if (sep[1] === '}') break;
    }
    entry.lastIndex = index;
    const authors = (fields['author'] ?? '').split(/\s+and\s+/i).map((name) => {
      const [family, given] = name.split(',').map((part) => part.trim());
      return given ? `${given} ${family}` : (family ?? '');
    }).filter((name) => name.length > 0);
    const item = build({ key: safeKey(match[2]), itemType: type, title: clean(fields['title'], 500), authors, year: yearOf(fields['year'] ?? fields['date']), citationKey: safeKey(match[2]), doi: clean(fields['doi'], 256), url: safeUrl(fields['url']), abstract: clean(fields['abstract'], 5000), container: clean(fields['journal'] ?? fields['booktitle'], 300), tags: (fields['keywords'] ?? '').split(/[,;]/).map((tag) => tag.trim()) });
    if (item) items.push(item);
  }
  return ok(items);
}

/** Zotero Web/local API JSON (`/api/users/0/items`), top-level items only. */
export function parseZoteroApiItems(value: unknown): Result<readonly ZoteroItem[], ZoteroError> {
  if (!Array.isArray(value)) return err({ code: 'ZOTERO_INVALID', message: 'Zotero API response must be an array' });
  const items: ZoteroItem[] = [];
  for (const raw of value.slice(0, MAX_ITEMS)) {
    if (!isRecord(raw) || !isRecord(raw['data'])) continue;
    const data = raw['data'];
    const itemType = clean(data['itemType'], 64);
    if (itemType === 'attachment' || itemType === 'note' || itemType === 'annotation') continue;
    const authors = Array.isArray(data['creators']) ? data['creators'].filter(isRecord).map((creator) => clean(creator['name'], 200) ?? [clean(creator['firstName'], 100), clean(creator['lastName'], 100)].filter(Boolean).join(' ')).filter((name) => name.length > 0) : [];
    const tags = Array.isArray(data['tags']) ? data['tags'].filter(isRecord).map((tag) => clean(tag['tag'], 64) ?? '') : [];
    const extraKey = /Citation Key:\s*(\S+)/i.exec(clean(data['extra'], 5000) ?? '')?.[1];
    const library = isRecord(raw['library']) ? clean(raw['library']['id'], 32) : undefined;
    const key = safeKey(raw['key'] ?? data['key']);
    const item = build({ key: key ? `${library ?? '0'}:${key}` : undefined, itemType, title: clean(data['title'], 500), authors, year: yearOf(data['date']), citationKey: safeKey(data['citationKey'] ?? extraKey), doi: clean(data['DOI'], 256), url: safeUrl(data['url']), abstract: clean(data['abstractNote'], 5000), container: clean(data['publicationTitle'] ?? data['bookTitle'], 300), tags });
    if (item) items.push(item);
  }
  return ok(items);
}

/** Short author-year citation, e.g. "Rahimi & Lee, 2024". */
export function formatCitation(item: ZoteroItem): string {
  const family = (name: string): string => name.split(' ').at(-1) ?? name;
  const names = item.authors.length === 0 ? 'Anon.' : item.authors.length === 1 ? family(item.authors[0]!) : item.authors.length === 2 ? `${family(item.authors[0]!)} & ${family(item.authors[1]!)}` : `${family(item.authors[0]!)} et al.`;
  return `${names}, ${item.year ?? 'n.d.'}`;
}

/** Stable, source-owned frontmatter fields; re-sync updates only these. */
export function literatureMetadata(item: ZoteroItem): Record<string, unknown> {
  return {
    title: item.title,
    type: 'literature',
    tags: ['literature', ...item.tags],
    authors: item.authors,
    zotero_key: item.key,
    item_type: item.itemType,
    ...(item.year ? { year: item.year } : {}),
    ...(item.citationKey ? { citekey: item.citationKey } : {}),
    ...(item.doi ? { doi: item.doi } : {}),
    ...(item.url ? { source: item.url } : {}),
    ...(item.container ? { container: item.container } : {}),
  };
}

export function literatureNote(item: ZoteroItem): Result<string, ZoteroError> {
  const escape = (text: string): string => text.replace(/([\\`*_[\]<>|])/g, '\\$1');
  const lines = [`# ${escape(item.title)}`, '', `*${escape(formatCitation(item))}*${item.container ? ` — ${escape(item.container)}` : ''}`, ''];
  if (item.abstract) lines.push('## Abstract', '', escape(item.abstract), '');
  lines.push('## Notes', '');
  const written = writeMetadata(`${lines.join('\n')}\n`, literatureMetadata(item));
  return written.ok ? ok(written.value) : err({ code: 'ZOTERO_INVALID', message: written.error.map((issue) => issue.message).join('; ') });
}

/** `Literature/<citekey or title>.md`, Windows-safe and unique against `exists`. */
export function literatureNotePath(item: ZoteroItem, exists: (vaultPath: string) => boolean): string {
  // eslint-disable-next-line no-control-regex -- control characters are invalid in Windows filenames
  const stem = (item.citationKey ?? item.title).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Untitled';
  const safeStem = /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem) ? `${stem} ref` : stem;
  let candidate = `Literature/${safeStem}.md`;
  for (let counter = 2; exists(candidate) && counter < 1000; counter += 1) candidate = `Literature/${safeStem} ${counter}.md`;
  return candidate;
}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Reads top-level items from the Zotero 7 desktop local API on loopback only. */
export async function fetchLocalZoteroItems(port: number, fetchImpl: FetchLike, timeoutMs = 5000): Promise<Result<readonly ZoteroItem[], ZoteroError>> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return err({ code: 'ZOTERO_INVALID', message: 'Port must be 1024-65535' });
  const url = `http://127.0.0.1:${port}/api/users/0/items/top?format=json&limit=100`;
  try {
    const response = await fetchImpl(url, { headers: { 'Zotero-API-Version': '3', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return err({ code: 'ZOTERO_UNAVAILABLE', message: `Zotero local API returned HTTP ${response.status}. Enable "Allow other applications to communicate with Zotero" in Zotero settings.` });
    const text = await response.text();
    if (text.length > MAX_IMPORT_BYTES) return err({ code: 'ZOTERO_INVALID', message: 'Zotero response is too large' });
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return err({ code: 'ZOTERO_PARSE_FAILED', message: 'Zotero response is not JSON' }); }
    return parseZoteroApiItems(parsed);
  } catch {
    return err({ code: 'ZOTERO_UNAVAILABLE', message: 'Zotero is not running or its local API is disabled' });
  }
}
