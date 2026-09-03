import { describe, expect, it } from 'vitest';
import { chunkNote, mergeHybridResults, SemanticIndex } from '../src/index.js';
import type { EmbeddingProviderProtocol } from '@knowledge-studio/ai-bridge';

const provider: EmbeddingProviderProtocol = { id: 'test.embed', displayName: 'Test', embed: ({ texts }) => Promise.resolve({ vectors: texts.map((text) => [text.length, 1]), dimensions: 2, model: 'test-v1' }) };

describe('chunkNote', () => {
  it('splits by bounded characters with stable IDs and line ranges', () => { const chunks = chunkNote('a.md', 'one\ntwo\nthree\nfour', 8); expect(chunks.length).toBeGreaterThan(1); expect(chunks[0]?.id).toBe('a.md#0'); expect(chunks[0]?.startLine).toBe(1); });
  it('does not emit empty whitespace chunks', () => { expect(chunkNote('a.md', '\n\n')).toEqual([]); });
});

describe('SemanticIndex', () => {
  it('rebuilds only when an embedding provider is explicitly supplied', async () => { const index = new SemanticIndex(); expect(index.isReady).toBe(false); const count = await index.rebuild([{ path: 'a.md', content: 'hello world' }], provider); expect(count).toBe(1); expect(index.isReady).toBe(true); expect(index.providerModel).toBe('test.embed'); });
  it('returns cosine-ranked semantic hits', async () => { const index = new SemanticIndex(); await index.rebuild([{ path: 'a.md', content: 'hello' }, { path: 'b.md', content: 'longer text' }], provider); const hits = index.search([5, 1]); expect(hits[0]?.notePath).toBe('a.md'); });
  it('clears without touching source content', async () => { const index = new SemanticIndex(); await index.rebuild([{ path: 'a.md', content: 'x' }], provider); index.clear(); expect(index.isReady).toBe(false); });
});

describe('mergeHybridResults', () => {
  it('blends lexical and semantic scores and includes semantic-only notes', () => { const result = mergeHybridResults([{ notePath: 'a.md', score: 10, snippet: 'lexical' }], [{ notePath: 'b.md', chunkId: 'b#0', score: 1, text: 'semantic', startLine: 1 }]); expect(result).toHaveLength(2); expect(result.find((hit) => hit.notePath === 'a.md')?.snippet).toBe('lexical'); expect(result.find((hit) => hit.notePath === 'b.md')?.snippet).toBe('semantic'); });
  it('accepts a configurable semantic weight', () => { const result = mergeHybridResults([{ notePath: 'a.md', score: 1, snippet: '' }], [{ notePath: 'a.md', chunkId: 'a#0', score: 1, text: '', startLine: 1 }], 0.8); expect(result[0]?.score).toBe(1); });
});
