/**
 * Provider-neutral AI protocols. Implementations may be local or remote,
 * but the core never imports a vendor SDK and never performs egress without
 * explicit configuration/disclosure (SECURITY.md). Interfaces are serializable
 * at the boundary and streams are async iterables for UI cancellation.
 */

export interface AIMessage { readonly role: 'system' | 'user' | 'assistant'; readonly content: string; }
export interface AIRequest { readonly messages: readonly AIMessage[]; readonly model?: string; readonly temperature?: number; readonly maxTokens?: number; readonly signal?: AbortSignal; }
export interface AIResponse { readonly content: string; readonly model: string; readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }; }
export interface AIStreamDelta { readonly content: string; readonly done: boolean; readonly usage?: AIResponse['usage']; }
export interface AIProviderCapabilities { readonly streaming: boolean; readonly vision: boolean; readonly embeddings: boolean; readonly models: readonly string[]; }

export interface AIProviderProtocol {
  readonly id: string;
  readonly displayName: string;
  capabilities(): Promise<AIProviderCapabilities>;
  complete(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest): AsyncIterable<AIStreamDelta>;
}

export interface EmbeddingRequest { readonly texts: readonly string[]; readonly model?: string; readonly signal?: AbortSignal; }
export interface EmbeddingResponse { readonly vectors: readonly (readonly number[])[]; readonly dimensions: number; readonly model: string; }
export interface EmbeddingProviderProtocol {
  readonly id: string;
  readonly displayName: string;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

export interface AIPrivacyDisclosure { readonly providerId: string; readonly remote: boolean; readonly endpoint?: string; readonly sendsVaultContent: boolean; readonly userConfirmed: boolean; }

/** Provider registry, empty by default so the app works with zero AI configured. */
export class AIProviderRegistry {
  private readonly providers = new Map<string, AIProviderProtocol>();
  private readonly embeddingProviders = new Map<string, EmbeddingProviderProtocol>();
  register(provider: AIProviderProtocol): void { if (this.providers.has(provider.id)) throw new Error(`AI provider already registered: ${provider.id}`); this.providers.set(provider.id, provider); }
  registerEmbedding(provider: EmbeddingProviderProtocol): void { if (this.embeddingProviders.has(provider.id)) throw new Error(`Embedding provider already registered: ${provider.id}`); this.embeddingProviders.set(provider.id, provider); }
  get(id: string): AIProviderProtocol | undefined { return this.providers.get(id); }
  getEmbedding(id: string): EmbeddingProviderProtocol | undefined { return this.embeddingProviders.get(id); }
  list(): readonly AIProviderProtocol[] { return [...this.providers.values()]; }
  listEmbeddings(): readonly EmbeddingProviderProtocol[] { return [...this.embeddingProviders.values()]; }
  clear(): void { this.providers.clear(); this.embeddingProviders.clear(); }
}

/** Local deterministic provider useful for tests and offline demos only. */
export class EchoAIProvider implements AIProviderProtocol {
  readonly id = 'local.echo';
  readonly displayName = 'Local Echo (test provider)';
  capabilities(): Promise<AIProviderCapabilities> { return Promise.resolve({ streaming: true, vision: false, embeddings: false, models: ['echo'] }); }
  complete(request: AIRequest): Promise<AIResponse> { const last = [...request.messages].reverse().find((message) => message.role === 'user'); return Promise.resolve({ content: last?.content ?? '', model: request.model ?? 'echo' }); }
  async *stream(request: AIRequest): AsyncIterable<AIStreamDelta> { const response = await this.complete(request); yield { content: response.content, done: false }; yield { content: '', done: true }; }
}

export function validateDisclosure(disclosure: AIPrivacyDisclosure): { ok: true } | { ok: false; error: string } {
  if (disclosure.remote && !disclosure.endpoint) return { ok: false, error: 'Remote providers require an explicit endpoint' };
  if (disclosure.sendsVaultContent && !disclosure.userConfirmed) return { ok: false, error: 'Sending vault content requires explicit user confirmation' };
  return { ok: true };
}
