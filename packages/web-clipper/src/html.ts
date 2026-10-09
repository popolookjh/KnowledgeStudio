import { classifyLink } from '@knowledge-studio/security';

/**
 * Dependency-free, non-executing HTML → Markdown conversion for web clips.
 * The input is treated purely as text: nothing is rendered, fetched, or
 * evaluated. Scripts, styles, frames, forms, and embedded objects are
 * dropped with their content; only http(s)/mailto links survive; images
 * become plain links so previews never load remote resources.
 */

const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'nav',
  'footer',
  'aside',
  'form',
  'button',
  'select',
  'textarea',
  'canvas',
  'video',
  'audio',
]);
const VOID = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'source',
  'wbr',
  'area',
  'base',
  'col',
  'track',
  'param',
]);
const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'header',
  'figure',
  'figcaption',
  'dl',
  'dt',
  'dd',
  'address',
  'details',
  'summary',
  'table',
  'body',
  'html',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  copy: '©',
  reg: '®',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  zwnj: '‌',
  zwj: '‍',
  rlm: '‏',
  lrm: '‎',
  middot: '·',
  bull: '•',
  times: '×',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern))
    attributes.set(match[1]!.toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  return attributes;
}

/** Escapes Markdown control characters and raw HTML openers in clipped text. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]<>|])/g, '\\$1');
}

/** Resolves a link against the page URL; returns null for anything not http(s)/mailto. */
export function safeHref(href: string | undefined, baseUrl?: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  let resolved = trimmed;
  const kind = classifyLink(trimmed);
  if (kind === 'unsafe-scheme') return null;
  if (kind === 'local-relative') {
    if (!baseUrl || trimmed.startsWith('#')) return null;
    try {
      resolved = new URL(trimmed, baseUrl).toString();
    } catch {
      return null;
    }
    if (classifyLink(resolved) !== 'safe-external') return null;
  }
  return resolved.replace(/[()\s]/g, (character) =>
    character === '(' ? '%28' : character === ')' ? '%29' : '%20',
  );
}

interface ListState {
  readonly ordered: boolean;
  counter: number;
}

export interface HtmlExtraction {
  readonly markdown: string;
  readonly title: string | null;
  readonly canonicalUrl: string | null;
  readonly siteName: string | null;
}

export function htmlToMarkdown(html: string, baseUrl?: string): HtmlExtraction {
  let out = '';
  let dropDepth = 0;
  let dropTag = '';
  let inPre = 0;
  let quoteDepth = 0;
  let title: string | null = null;
  let titleBuffer: string | null = null;
  let canonicalUrl: string | null = null;
  let siteName: string | null = null;
  let firstHeading: string | null = null;
  let headingBuffer: string | null = null;
  const lists: ListState[] = [];
  const links: { href: string | null; start: number }[] = [];
  let tableRow = 0;
  let rowCells = 0;

  const prefix = (): string => '> '.repeat(quoteDepth);
  const newline = (count = 1): void => {
    out = out.replace(/[ \t]+$/, '');
    const existing = /\n*$/.exec(out)?.[0].length ?? 0;
    if (out.length === 0) return;
    if (existing < count) out += '\n'.repeat(count - existing);
    if (quoteDepth > 0) out += prefix();
  };
  const emitText = (raw: string): void => {
    if (titleBuffer !== null) {
      titleBuffer += raw;
      return;
    }
    const decoded = decodeEntities(raw);
    if (headingBuffer !== null) headingBuffer += decoded;
    if (inPre > 0) {
      out += decoded;
      return;
    }
    const collapsed = decoded.replace(/\s+/g, ' ');
    if (collapsed.trim().length === 0) {
      if (!/[\s(]$/.test(out) && out.length > 0 && collapsed.length > 0) out += ' ';
      return;
    }
    const text = /(^|\n|> )$/.test(out) ? collapsed.replace(/^ /, '') : collapsed;
    out += escapeMarkdown(text);
  };

  const tokens =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</g;
  for (const match of html.matchAll(tokens)) {
    const token = match[0];
    const tagName = match[1]?.toLowerCase();
    if (!tagName) {
      if (token.startsWith('<!') || dropDepth > 0) continue;
      emitText(token);
      continue;
    }
    const closing = token.startsWith('</');
    const attributes = closing ? new Map<string, string>() : parseAttributes(match[2] ?? '');

    if (tagName === 'title' && !closing && title === null) {
      titleBuffer = '';
      continue;
    }
    if (tagName === 'title' && closing && titleBuffer !== null) {
      title = decodeEntities(titleBuffer).replace(/\s+/g, ' ').trim() || null;
      titleBuffer = null;
      continue;
    }
    if (!closing && (tagName === 'meta' || tagName === 'link')) {
      const property = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
      if (tagName === 'meta' && property === 'og:url' && !canonicalUrl)
        canonicalUrl = safeHref(attributes.get('content')) ?? null;
      if (tagName === 'meta' && property === 'og:site_name')
        siteName = attributes.get('content')?.trim() || null;
      if (tagName === 'meta' && property === 'og:title' && !title)
        title = attributes.get('content')?.trim() || null;
      if (
        tagName === 'link' &&
        (attributes.get('rel') ?? '').toLowerCase().split(/\s+/).includes('canonical')
      )
        canonicalUrl = safeHref(attributes.get('href'), baseUrl) ?? canonicalUrl;
      continue;
    }
    if (dropDepth > 0) {
      if (tagName === dropTag && !VOID.has(tagName)) dropDepth += closing ? -1 : 1;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tagName)) {
      if (!closing && !token.endsWith('/>')) {
        dropDepth = 1;
        dropTag = tagName;
      }
      continue;
    }

    switch (tagName) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
        if (closing) {
          if (firstHeading === null && headingBuffer !== null)
            firstHeading = headingBuffer.replace(/\s+/g, ' ').trim() || null;
          headingBuffer = null;
          newline(2);
        } else {
          newline(2);
          out += `${'#'.repeat(Number(tagName[1]))} `;
          headingBuffer = '';
        }
        break;
      case 'br':
        out += inPre > 0 ? '\n' : '  ';
        newline();
        break;
      case 'hr':
        newline(2);
        out += '---';
        newline(2);
        break;
      case 'strong':
      case 'b':
        out += '**';
        break;
      case 'em':
      case 'i':
        out += '*';
        break;
      case 'code':
        if (inPre === 0) out += '`';
        break;
      case 'pre':
        if (closing) {
          inPre = Math.max(0, inPre - 1);
          newline();
          out += '```';
          newline(2);
        } else {
          newline(2);
          out += '```';
          newline();
          inPre += 1;
        }
        break;
      case 'blockquote':
        if (closing) {
          quoteDepth = Math.max(0, quoteDepth - 1);
          newline(2);
        } else {
          quoteDepth += 1;
          newline(2);
        }
        break;
      case 'ul':
      case 'ol':
        if (closing) {
          lists.pop();
          if (lists.length === 0) newline(2);
        } else {
          lists.push({ ordered: tagName === 'ol', counter: 0 });
          newline(lists.length === 1 ? 2 : 1);
        }
        break;
      case 'li':
        if (!closing) {
          const list = lists.at(-1);
          newline();
          out += '  '.repeat(Math.max(0, lists.length - 1));
          if (list?.ordered) {
            list.counter += 1;
            out += `${list.counter}. `;
          } else out += '- ';
        }
        break;
      case 'a':
        if (closing) {
          const link = links.pop();
          if (link?.href) {
            const text = out.slice(link.start).trim();
            out = `${out.slice(0, link.start)}[${text || escapeMarkdown(link.href)}](${link.href})`;
          }
        } else links.push({ href: safeHref(attributes.get('href'), baseUrl), start: out.length });
        break;
      case 'img': {
        const src = safeHref(attributes.get('src'), baseUrl);
        const alt = escapeMarkdown((attributes.get('alt') ?? '').replace(/\s+/g, ' ').trim());
        if (src) out += `[Image${alt ? `: ${alt}` : ''}](${src})`;
        else if (alt) out += alt;
        break;
      }
      case 'tr':
        if (closing) {
          tableRow += 1;
          if (tableRow === 1) {
            newline();
            out += `|${' --- |'.repeat(Math.max(1, rowCells))}`;
          }
        } else {
          newline();
          out += '|';
          rowCells = 0;
        }
        break;
      case 'td':
      case 'th':
        if (closing) {
          out += ' |';
          rowCells += 1;
        } else out += ' ';
        break;
      case 'table':
        tableRow = 0;
        newline(2);
        break;
      default:
        if (BLOCK.has(tagName)) newline(2);
    }
  }

  const markdown = out
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { markdown, title: title ?? firstHeading, canonicalUrl, siteName };
}
