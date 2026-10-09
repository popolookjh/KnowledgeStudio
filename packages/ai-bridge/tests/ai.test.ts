import { describe, expect, it } from 'vitest';
import { AIProviderRegistry, EchoAIProvider, validateDisclosure } from '../src/index.js';

describe('AIProviderRegistry', () => {
  it('starts empty so core works with zero AI configured', () => {
    const registry = new AIProviderRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.listEmbeddings()).toEqual([]);
  });
  it('registers providers and rejects duplicate IDs', () => {
    const registry = new AIProviderRegistry();
    const provider = new EchoAIProvider();
    registry.register(provider);
    expect(registry.get('local.echo')).toBe(provider);
    expect(() => registry.register(provider)).toThrow(/already/);
  });
  it('clears providers', () => {
    const registry = new AIProviderRegistry();
    registry.register(new EchoAIProvider());
    registry.clear();
    expect(registry.list()).toHaveLength(0);
  });
});

describe('EchoAIProvider', () => {
  it('completes from the last user message', async () => {
    const response = await new EchoAIProvider().complete({
      messages: [{ role: 'user', content: 'سلام' }],
    });
    expect(response.content).toBe('سلام');
  });
  it('streams and terminates', async () => {
    const deltas: string[] = [];
    const provider = new EchoAIProvider();
    for await (const delta of provider.stream?.({
      messages: [{ role: 'user', content: 'hello' }],
    }) ?? [])
      deltas.push(delta.done ? 'done' : delta.content);
    expect(deltas).toEqual(['hello', 'done']);
  });
});

describe('privacy disclosure', () => {
  it('requires endpoint for remote providers', () => {
    expect(
      validateDisclosure({
        providerId: 'x',
        remote: true,
        sendsVaultContent: false,
        userConfirmed: false,
      }).ok,
    ).toBe(false);
  });
  it('requires confirmation before vault egress', () => {
    expect(
      validateDisclosure({
        providerId: 'x',
        remote: true,
        endpoint: 'https://example.test',
        sendsVaultContent: true,
        userConfirmed: false,
      }),
    ).toMatchObject({ ok: false });
  });
  it('accepts explicit disclosure', () => {
    expect(
      validateDisclosure({
        providerId: 'x',
        remote: true,
        endpoint: 'https://example.test',
        sendsVaultContent: true,
        userConfirmed: true,
      }),
    ).toEqual({ ok: true });
  });
});
