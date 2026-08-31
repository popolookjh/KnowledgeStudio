/**
 * Wiki link syntax: [[target]], [[target|alias]], [[target#heading]],
 * [[target#heading|alias]]. Also parses standard Markdown links so the
 * graph/backlink index covers both.
 */

export interface WikiLinkToken {
  /** Raw text between the brackets. */
  readonly raw: string;
  /** Note path portion (before `#`), trimmed; empty for `[[#heading]]`. */
  readonly target: string;
  /** Heading anchor portion (after `#`), or null. */
  readonly heading: string | null;
  /** Display alias, or null. */
  readonly alias: string | null;
  /** 0-based offset of `[[` in the source document. */
  readonly start: number;
  /** Offset one past `]]`. */
  readonly end: number;
  /** Line number (1-based) where the token starts. */
  readonly line: number;
}

export interface MarkdownLinkToken {
  /** Link destination as written. */
  readonly href: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
}

const WIKI_LINK_PATTERN = /\[\[([^\][]+?)\]\]/g;
// Negative lookbehind skips images (`![alt](src)`), which are not links.
const MARKDOWN_LINK_PATTERN = /(?<!!)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

/** Extracts every wiki-link token from a Markdown document. */
export function extractWikiLinks(content: string): readonly WikiLinkToken[] {
  const tokens: WikiLinkToken[] = [];
  const lines = lineStarts(content);
  for (const match of content.matchAll(WIKI_LINK_PATTERN)) {
    const raw = match[1] ?? '';
    const start = match.index ?? 0;
    // Ignore wiki-link syntax inside inline code spans / fenced blocks is
    // handled by the caller via the strip option; here we keep every match.
    const [pathAndHeading, alias] = splitAlias(raw);
    const [target, heading] = splitHeading(pathAndHeading);
    tokens.push({
      raw,
      target: target.trim(),
      heading: heading === null ? null : heading.trim(),
      alias: alias === null ? null : alias.trim(),
      start,
      end: start + match[0].length,
      line: lineOf(lines, start),
    });
  }
  return tokens;
}

/** Extracts standard Markdown links, skipping autolinks and images. */
export function extractMarkdownLinks(content: string): readonly MarkdownLinkToken[] {
  const tokens: MarkdownLinkToken[] = [];
  const lines = lineStarts(content);
  for (const match of content.matchAll(MARKDOWN_LINK_PATTERN)) {
    const href = match[2] ?? '';
    if (href.startsWith('data:') || href.startsWith('mailto:')) {
      continue;
    }
    const start = match.index ?? 0;
    tokens.push({
      href,
      start,
      end: start + match[0].length,
      line: lineOf(lines, start),
    });
  }
  return tokens;
}

/**
 * Removes content where link syntax is literal text, not a link: fenced
 * code blocks and inline code spans. Used by extractors to avoid indexing
 * code examples as links.
 */
export function stripCodeSpans(content: string): string {
  const withoutFences = content.replace(/^```.*?^```/gms, (matched) =>
    '\n'.repeat(matched.split('\n').length - 1),
  );
  return withoutFences.replace(/`[^`\n]*`/g, (matched) => ' '.repeat(matched.length));
}

function splitAlias(raw: string): [string, string | null] {
  const pipe = raw.indexOf('|');
  if (pipe === -1) {
    return [raw, null];
  }
  return [raw.slice(0, pipe), raw.slice(pipe + 1)];
}

function splitHeading(raw: string): [string, string | null] {
  const hash = raw.indexOf('#');
  if (hash === -1) {
    return [raw, null];
  }
  return [raw.slice(0, hash), raw.slice(hash + 1)];
}

function lineStarts(content: string): readonly number[] {
  const starts: number[] = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low + 1;
}
