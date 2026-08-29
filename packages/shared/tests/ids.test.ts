import { describe, expect, it } from 'vitest';
import { createId } from '../src/index.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createId', () => {
  it('generates RFC 4122 v4 identifiers', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(createId()).toMatch(UUID_V4);
    }
  });

  it('generates unique identifiers', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(createId());
    }
    expect(seen.size).toBe(1000);
  });
});
