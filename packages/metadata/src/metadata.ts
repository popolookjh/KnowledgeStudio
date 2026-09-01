import { err, ok, type Result } from '@knowledge-studio/shared';
import { splitFrontmatter } from '@knowledge-studio/markdown';
import { parse, stringify } from 'yaml';

/**
 * Typed metadata access over YAML frontmatter.
 *
 * Canonical properties (id, title, type, status, created, updated, tags,
 * aliases, project, author, source, confidence) get typed getters with
 * validation; everything else passes through untouched. Updates rewrite
 * ONLY the frontmatter block, preserving the body byte-for-byte, and
 * re-serialize YAML in a stable key order (known keys first, then the
 * rest alphabetically) — round-tripping a note never mangles content the
 * product does not understand.
 */

export interface NoteMetadata {
  readonly id?: string;
  readonly title?: string;
  readonly type?: string;
  readonly status?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly tags?: readonly string[];
  readonly aliases?: readonly string[];
  readonly project?: string;
  readonly author?: string;
  readonly source?: string;
  readonly confidence?: number;
  readonly [extraKey: string]: unknown;
}

export type MetadataIssue = { readonly key: string; readonly message: string };

/** Property order for stable serialization. */
const CANONICAL_KEYS = [
  'id',
  'title',
  'type',
  'status',
  'created',
  'updated',
  'tags',
  'aliases',
  'project',
  'author',
  'source',
  'confidence',
] as const;

/** Reads and type-checks metadata; never throws on note content. */
export function readMetadata(content: string): {
  data: NoteMetadata;
  issues: readonly MetadataIssue[];
} {
  const split = splitFrontmatter(content);
  if (split.frontmatter === null) {
    return { data: {}, issues: [] };
  }
  const issues: MetadataIssue[] = [];
  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = parse(split.frontmatter);
    if (parsed === undefined || parsed === null) {
      return { data: {}, issues: [] };
    }
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: {}, issues: [{ key: '', message: 'Frontmatter must be a mapping' }] };
    }
    raw = parsed as Record<string, unknown>;
  } catch (error) {
    return {
      data: {},
      issues: [{ key: '', message: `Invalid YAML: ${error instanceof Error ? error.message : String(error)}` }],
    };
  }
  const data: Record<string, unknown> = { ...raw };
  for (const key of ['tags', 'aliases']) {
    const value = raw[key];
    if (value !== undefined && !isStringArray(value)) {
      issues.push({ key, message: `${key} must be a list of strings` });
      delete data[key];
    }
  }
  const confidence = raw['confidence'];
  if (
    confidence !== undefined &&
    (typeof confidence !== 'number' || Number.isNaN(confidence))
  ) {
    issues.push({ key: 'confidence', message: 'confidence must be a number' });
    delete data['confidence'];
  }
  return { data, issues };
}

/**
 * Serializes metadata to a frontmatter block. Unknown keys are preserved;
 * keys with `undefined` values are dropped. `data` must be a plain object.
 */
export function serializeMetadata(data: NoteMetadata): string {
  const ordered: Record<string, unknown> = {};
  const present = new Set(Object.keys(data));
  for (const key of CANONICAL_KEYS) {
    if (present.has(key)) {
      ordered[key] = data[key];
      present.delete(key);
    }
  }
  for (const key of [...present].sort((a, b) => a.localeCompare(b, 'en'))) {
    const value = data[key];
    if (value !== undefined) {
      ordered[key] = value;
    }
  }
  const body = stringify(ordered, { lineWidth: 100 }).trimEnd();
  return `---\n${body}\n---\n`;
}

/**
 * Applies a metadata patch to a note: replaces the frontmatter block (or
 * prepends one) while keeping the body byte-for-byte identical. Returns
 * the new full note content.
 */
export function writeMetadata(content: string, data: NoteMetadata): Result<string, MetadataIssue[]> {
  const issues = validate(data);
  if (issues.length > 0) {
    return err(issues);
  }
  const split = splitFrontmatter(content);
  return ok(serializeMetadata(data) + split.body);
}

function validate(data: NoteMetadata): MetadataIssue[] {
  const issues: MetadataIssue[] = [];
  if (data.tags !== undefined && !isStringArray(data.tags)) {
    issues.push({ key: 'tags', message: 'tags must be a list of strings' });
  }
  if (data.aliases !== undefined && !isStringArray(data.aliases)) {
    issues.push({ key: 'aliases', message: 'aliases must be a list of strings' });
  }
  if (
    data.confidence !== undefined &&
    (typeof data.confidence !== 'number' || Number.isNaN(data.confidence))
  ) {
    issues.push({ key: 'confidence', message: 'confidence must be a number' });
  }
  return issues;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Touch helper: sets `updated` to the current ISO timestamp. */
export function withUpdatedStamp(data: NoteMetadata, now = new Date()): NoteMetadata {
  return { ...data, updated: now.toISOString() };
}
