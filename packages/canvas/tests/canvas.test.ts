import { describe, expect, it } from 'vitest';
import {
  addEdge,
  addNode,
  EMPTY_CANVAS,
  parseCanvas,
  removeNode,
  serializeCanvas,
  updateNode,
  updateViewport,
} from '../src/index.js';

const note = { kind: 'note' as const, id: 'n1', path: 'notes/a.md', position: { x: 10, y: 20 }, size: { width: 240, height: 120 } };
const text = { kind: 'text' as const, id: 'n2', text: 'hello', position: { x: 300, y: 20 }, size: { width: 180, height: 100 } };

describe('CanvasDocument', () => {
  it('has an original, explicit format marker', () => {
    expect(EMPTY_CANVAS.format).toBe('knowledge-studio.canvas');
    expect(EMPTY_CANVAS.version).toBe(1);
  });
  it('round-trips human-readable JSON', () => {
    const board = addEdge(addNode(addNode(EMPTY_CANVAS, note), text), { id: 'e1', source: 'n1', target: 'n2' });
    const parsed = parseCanvas(JSON.parse(serializeCanvas(board)));
    expect(parsed.ok && parsed.value).toEqual(board);
  });
  it('rejects invalid docs and dangling edge endpoints', () => {
    expect(parseCanvas({ format: 'other', version: 1 })).toMatchObject({ ok: false });
    expect(
      parseCanvas({
        format: 'knowledge-studio.canvas',
        version: 1,
        viewport: { x: Infinity, y: 0, zoom: 1 },
      }),
    ).toMatchObject({ ok: false });
    expect(() =>
      addEdge(addNode(EMPTY_CANVAS, note), { id: 'e', source: 'n1', target: 'missing' }),
    ).toThrow(/endpoints/);
  });
  it('updates and removes nodes, including connected edges', () => {
    const board = addEdge(addNode(addNode(EMPTY_CANVAS, note), text), { id: 'e1', source: 'n1', target: 'n2' });
    const moved = updateNode(board, 'n1', { position: { x: 99, y: 88 } });
    expect(moved.nodes[0]?.position).toEqual({ x: 99, y: 88 });
    const removed = removeNode(moved, 'n1');
    expect(removed.nodes).toHaveLength(1);
    expect(removed.edges).toHaveLength(0);
  });
  it('updates the validated persisted viewport', () => {
    const moved = updateViewport(EMPTY_CANVAS, { x: 80, y: -12, zoom: 1.5 });
    expect(moved.viewport).toEqual({ x: 80, y: -12, zoom: 1.5 });
    expect(() => updateViewport(moved, { zoom: 0 })).toThrow();
    expect(() => updateViewport(moved, { x: Number.NaN })).toThrow();
  });
  it('rejects non-positive resize dimensions', () => {
    const board = addNode(EMPTY_CANVAS, note);
    expect(() => updateNode(board, 'n1', { size: { width: 0, height: 30 } })).toThrow();
  });
  it('rejects duplicate IDs', () => {
    expect(() => addNode(addNode(EMPTY_CANVAS, note), note)).toThrow(/already exists/);
  });
});
