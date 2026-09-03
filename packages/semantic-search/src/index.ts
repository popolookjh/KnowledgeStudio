import type { EmbeddingProviderProtocol } from '@knowledge-studio/ai-bridge';

/** Optional semantic layer. Markdown remains the source of truth. */

export interface NoteChunk { readonly id: string; readonly notePath: string; readonly text: string; readonly startLine: number; readonly endLine: number; }
export interface EmbeddedChunk extends NoteChunk { readonly vector: readonly number[]; readonly model: string; }
export interface SemanticHit { readonly notePath: string; readonly chunkId: string; readonly score: number; readonly text: string; readonly startLine: number; }
export interface HybridHit { readonly notePath: string; readonly lexicalScore: number; readonly semanticScore: number; readonly score: number; readonly snippet: string; }

/** Splits a note into stable, bounded chunks without embedding anything. */
export function chunkNote(notePath: string, content: string, maxCharacters = 1200): readonly NoteChunk[] {
  const lines = content.split(/\r?\n/); const chunks: NoteChunk[] = []; let text = ''; let start = 1; let id = 0;
  const flush = (endLine: number): void => { if (text.trim().length === 0) return; chunks.push({ id: `${notePath}#${id++}`, notePath, text: text.trim(), startLine: start, endLine }); text = ''; };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (text.length + line.length + 1 > maxCharacters && text.length > 0) flush(index);
    if (text.length === 0) start = index + 1;
    text += `${line}\n`;
  }
  flush(lines.length); return chunks;
}

export class SemanticIndex {
  private readonly chunks = new Map<string, EmbeddedChunk>();
  private model = '';
  async rebuild(notes: readonly { path: string; content: string }[], provider: EmbeddingProviderProtocol): Promise<number> {
    this.chunks.clear(); this.model = provider.id;
    for (const note of notes) {
      const pieces = chunkNote(note.path, note.content);
      const response = await provider.embed({ texts: pieces.map((piece) => piece.text) });
      if (response.vectors.length !== pieces.length) throw new Error('Embedding provider returned a mismatched vector count');
      pieces.forEach((piece, index) => this.chunks.set(piece.id, { ...piece, vector: response.vectors[index] ?? [], model: response.model }));
    }
    return this.chunks.size;
  }
  clear(): void { this.chunks.clear(); this.model = ''; }
  get isReady(): boolean { return this.chunks.size > 0; }
  get providerModel(): string { return this.model; }
  search(vector: readonly number[], limit = 20): readonly SemanticHit[] {
    return [...this.chunks.values()].map((chunk) => ({ ...chunk, score: cosine(vector, chunk.vector), chunkId: chunk.id, notePath: chunk.notePath, startLine: chunk.startLine })).sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/** Weighted reciprocal blend of lexical and semantic rankings. */
export function mergeHybridResults(lexical: readonly { notePath: string; score: number; snippet: string }[], semantic: readonly SemanticHit[], semanticWeight = 0.35): readonly HybridHit[] {
  const semByNote = new Map<string, number>(); for (const hit of semantic) semByNote.set(hit.notePath, Math.max(semByNote.get(hit.notePath) ?? 0, hit.score));
  const maxLex = Math.max(1, ...lexical.map((hit) => hit.score)); const all = new Map<string, HybridHit>();
  for (const hit of lexical) { const sem = semByNote.get(hit.notePath) ?? 0; all.set(hit.notePath, { notePath: hit.notePath, lexicalScore: hit.score, semanticScore: sem, score: (1 - semanticWeight) * (hit.score / maxLex) + semanticWeight * sem, snippet: hit.snippet }); }
  for (const hit of semantic) if (!all.has(hit.notePath)) all.set(hit.notePath, { notePath: hit.notePath, lexicalScore: 0, semanticScore: hit.score, score: semanticWeight * hit.score, snippet: hit.text });
  return [...all.values()].sort((a, b) => b.score - a.score);
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0; let dot = 0; let aa = 0; let bb = 0;
  for (let index = 0; index < a.length; index += 1) { const x = a[index] ?? 0; const y = b[index] ?? 0; dot += x * y; aa += x * x; bb += y * y; }
  return aa === 0 || bb === 0 ? 0 : dot / Math.sqrt(aa * bb);
}
