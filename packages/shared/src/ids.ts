export function isUuidV4(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  );
}

export function createDocumentId(): string {
  return createId();
}
export function createVaultId(): string {
  return createId();
}
export function sourceIdFor(vaultId: string, documentId: string): string {
  return `ks:${vaultId}:${documentId}`;
}

export function createId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return cryptoRef.randomUUID();
  }
  // Non-secure contexts (and some embedders) lack randomUUID; fall back to
  // getRandomValues, and to a timestamp-based value only if even that is
  // unavailable. Uniqueness matters more than cryptographic strength here.
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    const bytes = cryptoRef.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const fallback = `${Date.now().toString(16)}-${Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')}`;
  return `00000000-0000-4000-8000-${fallback.padStart(12, '0').slice(-12)}`;
}
