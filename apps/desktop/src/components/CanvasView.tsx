import { useEffect, useMemo, useRef, useState } from 'react';
import { addEdge, addNode, EMPTY_CANVAS, parseCanvas, removeNode, serializeCanvas, updateNode, type CanvasDocument, type CanvasNode } from '@knowledge-studio/canvas';
import { store, useAppState } from '../state/store';

/** Original canvas board UI: pan, zoom, drag nodes, connect and persist JSON. */
export function CanvasView(): React.JSX.Element {
  const { bridge, sessionRoot } = useAppState();
  const [document, setDocument] = useState<CanvasDocument>(EMPTY_CANVAS);
  const [canvasPath, setCanvasPath] = useState('boards/main.ks-canvas.json');
  const [status, setStatus] = useState('Unsaved board');
  const [scale, setScale] = useState(1);
  const [offset] = useState({ x: 40, y: 40 });
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const nodeMap = useMemo(() => new Map(document.nodes.map((node) => [node.id, node])), [document.nodes]);

  useEffect(() => {
    if (!bridge || !sessionRoot) return;
    void bridge.readCanvas(canvasPath).then((result) => {
      if (result.ok) {
        const parsed = parseCanvas(JSON.parse(result.value) as unknown);
        if (parsed.ok) { setDocument(parsed.value); setStatus('Loaded'); }
      }
    }).catch(() => undefined);
  }, [bridge, sessionRoot, canvasPath]);

  const persist = async (next: CanvasDocument): Promise<void> => {
    setDocument(next);
    if (!bridge) return;
    const result = await bridge.writeCanvas(canvasPath, serializeCanvas(next));
    setStatus(result.ok ? 'Saved' : `Save failed: ${result.error.message}`);
  };

  const addText = (): void => {
    const id = `text-${Date.now()}`;
    void persist(addNode(document, { kind: 'text', id, text: 'New idea', position: { x: 120, y: 100 }, size: { width: 180, height: 100 } }));
  };
  const addNote = (): void => {
    const path = store.getState().activePath;
    if (!path) return;
    const id = `note-${Date.now()}`;
    void persist(addNode(document, { kind: 'note', id, path, label: path.split('/').pop(), position: { x: 180, y: 180 }, size: { width: 220, height: 120 } }));
  };
  const remove = (id: string): void => { void persist(removeNode(document, id)); };
  const connect = (): void => {
    const [source, target] = document.nodes;
    if (!source || !target) return;
    try { void persist(addEdge(document, { id: `edge-${Date.now()}`, source: source.id, target: target.id })); } catch { setStatus('Add at least two nodes first'); }
  };

  if (!sessionRoot) return <div className="canvas canvas--empty">Open a vault to use Canvas.</div>;
  return (
    <div className="canvas">
      <div className="canvas__toolbar">
        <input value={canvasPath} onChange={(event) => setCanvasPath(event.target.value)} aria-label="Canvas path" />
        <button type="button" className="btn btn--small" onClick={addNote}>+ Active note</button>
        <button type="button" className="btn btn--small" onClick={addText}>+ Text</button>
        <button type="button" className="btn btn--small" onClick={connect}>Connect first two</button>
        <button type="button" className="btn btn--small" onClick={() => setScale((value) => Math.min(2, value + 0.1))}>＋</button>
        <button type="button" className="btn btn--small" onClick={() => setScale((value) => Math.max(0.4, value - 0.1))}>－</button>
        <span className="canvas__status">{status}</span>
      </div>
      <div className="canvas__board" ref={boardRef} onPointerUp={() => setDrag(null)} onWheel={(event) => { event.preventDefault(); setScale((value) => Math.max(0.4, Math.min(2, value - event.deltaY * 0.001))); }}>
        <div className="canvas__world" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
          <svg className="canvas__edges" aria-hidden="true">
            {document.edges.map((edge) => {
              const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target);
              if (!source || !target) return null;
              return <line key={edge.id} x1={source.position.x + source.size.width / 2} y1={source.position.y + source.size.height / 2} x2={target.position.x + target.size.width / 2} y2={target.position.y + target.size.height / 2} stroke="var(--accent)" strokeWidth="2" markerEnd="url(#arrow)" />;
            })}
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--accent)" /></marker></defs>
          </svg>
          {document.nodes.map((node) => <CanvasNodeView key={node.id} node={node} onDelete={remove} onDragStart={(event) => { const rect = boardRef.current?.getBoundingClientRect(); if (!rect) return; setDrag({ id: node.id, dx: (event.clientX - rect.left - offset.x) / scale - node.position.x, dy: (event.clientY - rect.top - offset.y) / scale - node.position.y }); }} onDragMove={(event) => { if (!drag || drag.id !== node.id) return; const rect = boardRef.current?.getBoundingClientRect(); if (!rect) return; const next = updateNode(document, node.id, { position: { x: (event.clientX - rect.left - offset.x) / scale - drag.dx, y: (event.clientY - rect.top - offset.y) / scale - drag.dy } }); setDocument(next); }} />)}
        </div>
      </div>
    </div>
  );
}

function CanvasNodeView({ node, onDelete, onDragStart, onDragMove }: { node: CanvasNode; onDelete: (id: string) => void; onDragStart: (event: React.PointerEvent) => void; onDragMove: (event: React.PointerEvent) => void }): React.JSX.Element {
  return <div className={`canvas-node canvas-node--${node.kind}`} style={{ left: node.position.x, top: node.position.y, width: node.size.width, height: node.size.height }} onPointerDown={onDragStart} onPointerMove={onDragMove}>
    <div className="canvas-node__header"><span>{node.kind === 'note' ? '📝' : '▦'} {node.kind}</span><button type="button" onClick={(event) => { event.stopPropagation(); onDelete(node.id); }}>×</button></div>
    <div className="canvas-node__body">{node.kind === 'note' ? node.label ?? node.path : node.kind === 'text' ? node.text : node.kind === 'image' ? node.alt ?? node.path : node.kind === 'group' ? node.label ?? 'Group' : node.label ?? node.url}</div>
  </div>;
}
