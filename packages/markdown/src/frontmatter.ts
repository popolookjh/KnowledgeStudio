import { err, ok, type Result } from '@knowledge-studio/shared';
import { parse as parseYaml } from 'yaml';

/**
 * YAML frontmatter extraction.
 *
 * Only a well-formed leading block counts: the document must start with a
 * `---` fence, close with a `---` or `...` fence on its own line, and be
 * followed by content (or end of file). Anything else is note body — a
 * malformed "frontmatter" never swallows the user's content.
 */

export interface FrontmatterSplit {
  /** Raw YAML text between the fences, or null when there is no block. */
  readonly frontmatter: string | null;
  /** The remainder of the note (everything after the closing fence). */
  readonly body: string;
  /** 1-based line number where the body starts (for editor positioning). */
  readonly bodyStartLine: number;
}

const OPENING_FENCE = '---';
const CLOSING_FENCES = new Set(['---', '...']);

/** Splits a note into frontmatter text and Markdown body. */
export function splitFrontmatter(content: string): FrontmatterSplit {
  const normalized = content.replace(/^\uFEFF/, '');
  const lines = normalized.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== OPENING_FENCE) {
    return { frontmatter: null, body: normalized, bodyStartLine: 1 };
  }
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (CLOSING_FENCES.has(line.trim())) {
      const frontmatter = lines.slice(1, index).join('\n');
      const body = lines.slice(index + 1).join('\n');
      return {
        frontmatter,
        body,
        bodyStartLine: index + 2,
      };
    }
  }
  // Unterminated fence: treat the whole document as body, never as metadata.
  return { frontmatter: null, body: normalized, bodyStartLine: 1 };
}

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | readonly unknown[]
  | { readonly [key: string]: unknown };

export type ParsedFrontmatter = Readonly<Record<string, unknown>>;

export interface FrontmatterIssue {
  readonly key?: string;
  readonly message: string;
}

/**
 * Parses frontmatter YAML into a plain record. YAML errors (and non-mapping
 * documents) become issues instead of exceptions; unknown properties are
 * preserved untouched — the product never rewrites what it does not own.
 */
export function parseFrontmatter(raw: string): Result<ParsedFrontmatter, FrontmatterIssue[]> {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err([{ message: `Invalid YAML: ${message}` }]);
  }
  if (parsed === undefined || parsed === null) {
    return ok({});
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err([{ message: 'Frontmatter must be a YAML mapping of key: value pairs' }]);
  }
  return ok(parsed as ParsedFrontmatter);
}

/**
 * Convenience: extract and parse in one step. Content and YAML problems are
 * both surfaced as issues; the body is always returned so a broken header
 * never blocks editing.
 */
export function readFrontmatter(
  content: string,
): { body: string; bodyStartLine: number; data: ParsedFrontmatter; issues: readonly FrontmatterIssue[] } {
  const split = splitFrontmatter(content);
  if (split.frontmatter === null) {
    return { body: split.body, bodyStartLine: split.bodyStartLine, data: {}, issues: [] };
  }
  const parsed = parseFrontmatter(split.frontmatter);
  return parsed.ok
    ? { body: split.body, bodyStartLine: split.bodyStartLine, data: parsed.value, issues: [] }
    : { body: split.body, bodyStartLine: split.bodyStartLine, data: {}, issues: parsed.error };
}
