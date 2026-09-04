import { describe, expect, it } from 'vitest';
import { linkIndex } from './linkIndex';

describe('linkIndex React snapshot', () => {
  it('exposes a stable primitive snapshot for useSyncExternalStore', () => {
    const before = linkIndex.getSnapshot();
    expect(typeof before).toBe('number');
    expect(linkIndex.getSnapshot()).toBe(before);

    linkIndex.updateNote('snapshot-regression.md', '# Snapshot regression');
    expect(linkIndex.getSnapshot()).toBe(before + 1);
    linkIndex.removeNote('snapshot-regression.md');
  });
});
