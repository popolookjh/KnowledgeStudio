import { readFrontmatter } from '@knowledge-studio/markdown';

/** Tag extraction and index. Tags are source content, never standalone DB data. */

export interface TagOccurrence {
  readonly tag: string;
  readonly line: number;
  readonly source: 'inline' | 'frontmatter';
}

/**
 * Inline tags: `#idea`, `#project/alpha`, Persian tags. Leading `#` in a
 * Markdown heading is excluded; tags inside inline/fenced code are stripped
 * first. Tags require a letter/number after #, so URLs/fragments don't count.
 */
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

export function extractTags(content: string): readonly TagOccurrence[] {
  const result: TagOccurrence[] = [];
  const seen = new Set<string>();
  const frontmatter = readFrontmatter(content);
  const frontTags = frontmatter.data['tags'];
  if (Array.isArray(frontTags)) {
    for (const raw of frontTags) {
      if (typeof raw === 'string') {
        const tag = canonicalize(raw);
        if (tag.length > 0 && !seen.has(tag)) {
          seen.add(tag);
          result.push({ tag, line: 1, source: 'frontmatter' });
        }
      }
    }
  }
  const bodyLines = frontmatter.body.split(/\r?\n/);
  let inFence = false;
  for (let lineIndex = 0; lineIndex < bodyLines.length; lineIndex += 1) {
    const line = bodyLines[lineIndex] ?? '';
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s{0,3}#{1,6}\s/.test(line)) {
      continue;
    }
    const withoutCode = line.replace(/`[^`]*`/g, '');
    for (const match of withoutCode.matchAll(INLINE_TAG)) {
      const tag = canonicalize(match[2] ?? '');
      if (tag.length > 0 && !seen.has(tag)) {
        seen.add(tag);
        result.push({ tag, line: lineIndex + frontmatter.bodyStartLine, source: 'inline' });
      }
    }
  }
  return result;
}

export function canonicalize(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\/+$/, '').toLowerCase();
}

export class TagIndex {
  private readonly byTag = new Map<string, Set<string>>();
  private readonly byPath = new Map<string, readonly string[]>();

  update(path: string, tags: readonly TagOccurrence[]): void {
    this.remove(path);
    const values = [...new Set(tags.map((entry) => entry.tag))];
    this.byPath.set(path, values);
    for (const tag of values) {
      const paths = this.byTag.get(tag) ?? new Set<string>();
      paths.add(path);
      this.byTag.set(tag, paths);
    }
  }

  remove(path: string): void {
    const old = this.byPath.get(path) ?? [];
    for (const tag of old) {
      const paths = this.byTag.get(tag);
      paths?.delete(path);
      if (paths?.size === 0) {
        this.byTag.delete(tag);
      }
    }
    this.byPath.delete(path);
  }

  tags(): readonly { tag: string; count: number }[] {
    return [...this.byTag.entries()]
      .map(([tag, paths]) => ({ tag, count: paths.size }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'en'));
  }

  pathsFor(tag: string): readonly string[] {
    return [...(this.byTag.get(canonicalize(tag)) ?? [])].sort((a, b) => a.localeCompare(b, 'en'));
  }
}
