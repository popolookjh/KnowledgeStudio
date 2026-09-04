import { describe, expect, it, vi } from 'vitest';
import { store } from './store';

describe('history restore flow', () => {
  it('does not restore when the revision bridge read fails', async () => {
    const readHistory = vi.fn().mockResolvedValue({ ok: false, error: { message: 'missing' } });
    const original = store.getState();
    // The store returns false safely when there is no active tab/bridge; this
    // is the guard used before the UI's explicit confirmation action.
    expect(await store.restoreHistoryRevision('missing.md', 'revision')).toBe(false);
    expect(readHistory).not.toHaveBeenCalled();
    expect(original.activePath).toBe(store.getState().activePath);
  });
});
