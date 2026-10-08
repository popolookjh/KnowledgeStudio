/**
 * Retrieval V2 helpers: heading-aware Markdown chunking and deterministic,
 * Unicode-aware passage scoring (works for Persian and mixed-direction
 * text). Pure functions — no I/O — so ranking is reproducible and testable.
 */

export interface Chunk { readonly index: number; readonly heading: string | null; readonly text: string; }
export interface ScoredChunk extends Chunk { readonly score: number; }

const MAX_CHUNK_CHARS = 1200;

/** Strips YAML frontmatter and splits the body at headings, then by size. */
export function chunkMarkdown(content: string): readonly Chunk[] {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];
  let inFence = false;
  const flush = (): void => {
    let text = buffer.join('\n').trim();
    buffer = [];
    while (text.length > 0) {
      let cut = text.length <= MAX_CHUNK_CHARS ? text.length : text.lastIndexOf('\n\n', MAX_CHUNK_CHARS);
      if (cut <= 0) cut = text.lastIndexOf(' ', MAX_CHUNK_CHARS);
      if (cut <= 0) cut = MAX_CHUNK_CHARS;
      chunks.push({ index: chunks.length, heading, text: text.slice(0, cut).trim() });
      text = text.slice(cut).trim();
    }
  };
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2]!.replace(/\s+#+\s*$/, '').trim() || null;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return chunks;
}

/** Lower-cased word tokens; Persian/Arabic letters and ZWNJ-joined words stay intact. */
export function tokenize(text: string): readonly string[] {
  return (text.normalize('NFKC').toLocaleLowerCase().replace(/[ً-ٰٟ]/g, '').match(/[\p{L}\p{N}‌]+/gu) ?? []).map((token) => token.replace(/‌/g, '')).filter((token) => token.length > 0);
}

/** Scores chunks by query-term frequency with heading and coverage boosts. */
export function scoreChunks(chunks: readonly Chunk[], query: string): readonly ScoredChunk[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return [];
  return chunks
    .map((chunk) => {
      const tokens = tokenize(chunk.text);
      const headingTokens = new Set(tokenize(chunk.heading ?? ''));
      let score = 0;
      let covered = 0;
      for (const term of terms) {
        const hits = tokens.filter((token) => token === term || token.startsWith(term)).length;
        if (hits > 0) covered += 1;
        score += Math.log1p(hits) + (headingTokens.has(term) ? 1.5 : 0);
      }
      const coverage = covered / terms.length;
      return { ...chunk, score: score === 0 ? 0 : Number((score * (0.5 + coverage)).toFixed(4)) };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
