import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';
import type { Root, RootContent } from 'mdast';

/**
 * Heading outline extraction over the remark AST. One parser (remark + GFM)
 * is shared by the editor, outline, and index so structure never drifts
 * between surfaces (ADR-0004).
 */

export interface OutlineEntry {
  /** 1-based line of the heading in the note body. */
  readonly line: number;
  /** 1-based column of the heading marker. */
  readonly column: number;
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Visible text of the heading (inline markup flattened). */
  readonly text: string;
  /** Stable anchor id derived from the text (used for scroll-to-heading). */
  readonly slug: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdownAst(markdown: string): Root {
  return parser.parse(markdown);
}

/** Extracts the heading outline from Markdown source. */
export function extractOutline(markdown: string): readonly OutlineEntry[] {
  const tree = parseMarkdownAst(markdown);
  const entries: OutlineEntry[] = [];
  const usedSlugs = new Set<string>();
  const visit = (nodes: readonly RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'heading' && node.position) {
        const text = flattenText(node.children);
        if (text.length > 0) {
          const level = Math.min(6, Math.max(1, node.depth)) as OutlineEntry['level'];
          entries.push({
            line: node.position.start.line,
            column: node.position.start.column,
            level,
            text,
            slug: uniqueSlug(slugify(text), usedSlugs),
          });
        }
      }
      if ('children' in node && Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  };
  visit(tree.children);
  return entries;
}

function flattenText(nodes: readonly RootContent[]): string {
  const parts: string[] = [];
  const visit = (nodes: readonly RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'text') {
        parts.push(node.value);
      } else if (node.type === 'inlineCode') {
        parts.push(node.value);
      } else if (node.type === 'image' && 'alt' in node && typeof node.alt === 'string') {
        parts.push(node.alt);
      } else if ('children' in node && Array.isArray(node.children)) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * GitHub-style slug: lowercase, strip punctuation, spaces to dashes.
 * Unicode letters (including Persian) are preserved.
 */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
  );
}

function uniqueSlug(base: string, used: Set<string>): string {
  const root = base.length > 0 ? base : 'heading';
  let slug = root;
  let counter = 2;
  while (used.has(slug)) {
    slug = `${root}-${counter}`;
    counter += 1;
  }
  used.add(slug);
  return slug;
}
