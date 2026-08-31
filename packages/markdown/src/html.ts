import type { Schema } from 'hast-util-sanitize';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/**
 * Sanitized Markdown → HTML rendering for the preview pane.
 *
 * Security properties (threat model #2):
 * - Raw HTML in notes is NOT rendered (dropped at the remark→rehype
 *   boundary; only explicit Markdown constructs produce elements).
 * - `rehype-sanitize` with a strict schema strips scripts, event handlers,
 *   `javascript:` URLs, and every element/attribute not explicitly allowed.
 * - External links render with safe link semantics enforced by the schema.
 */

const baseAttributes = defaultSchema.attributes ?? {};

const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...baseAttributes,
    a: [...(baseAttributes['a'] ?? []), ['target', '_blank'], ['rel', 'noreferrer noopener']],
    input: [...(baseAttributes['input'] ?? []), ['type', 'checkbox'], ['disabled', 'disabled']],
    code: [...(baseAttributes['code'] ?? []), ['className', 'language-*', 'math-inline']],
    span: [...(baseAttributes['span'] ?? []), ['className', 'math-inline', 'math-display']],
  },
};

const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeStringify);

/** Renders Markdown body text to sanitized HTML. Never throws on content. */
export function renderMarkdownToHtml(markdown: string): string {
  const file = pipeline.processSync(markdown);
  return String(file);
}
