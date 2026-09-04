import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addEdge,
  addNode,
  EMPTY_CANVAS,
  parseCanvas,
  removeNode,
  serializeCanvas,
  updateNode,
  updateViewport,
  type CanvasDocument,
  type CanvasNode,
  type CanvasViewport,
} from '@knowledge-studio/canvas';
import { store, useAppState } from '../state/store';

const MIN_NODE_WIDTH = 120;
const MIN_NODE_HEIGHT = 80;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 2;

type Gesture =
  | { readonly kind: 'pan'; readonly pointerId: number; readonly startX: number; readonly startY: number; readonly viewport: CanvasViewport }
  | { readonly kind: 'move'; readonly pointerId: number; readonly nodeId: string; readonly startX: number; readonly startY: number; readonly position: CanvasNode['position'] }
  | { readonly kind: 'resize'; readonly pointerId: number; readonly nodeId: string; readonly startX: number; readonly startY: number; readonly size: CanvasNode['size'] };

/**
 * Original Canvas board: persisted pan/zoom, pointer-captured node movement,
 * selection, resizing, and selected-node connections. The JSON document is
 * the sole persisted board state; selection/gesture state stays transient.
 */
export function CanvasView(): React.JSX.Element {
  const { bridge, sessionRoot } = useAppState();
  const [document, setDocument] = useState<CanvasDocument>(EMPTY_CANVAS);
  const [canvasPath, setCanvasPath] = useState('boards/main.ks-canvas.json');
  const [status, setStatus] = useState('Unsaved board');
  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const documentRef = useRef(document);
  const persistRef = useRef<(next: CanvasDocument) => void>(() => undefined);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  documentRef.current = document;
  const nodeMap = useMemo(() => new Map(document.nodes.map((node) => [node.id, node])), [document.nodes]);

  useEffect(() => {
    if (!bridge || !sessionRoot) return;
    void bridge
      .readCanvas(canvasPath)
      .then((result) => {
        if (!result.ok) return;
        const parsed = parseCanvas(JSON.parse(result.value) as unknown);
        if (parsed.ok) {
          setDocument(parsed.value);
          setSelectedNodeIds(new Set());
          setStatus('Loaded');
        } else {
          setStatus(`Invalid canvas: ${parsed.errors[0] ?? 'unknown error'}`);
        }
      })
      .catch(() => undefined);
  }, [bridge, sessionRoot, canvasPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (selectedNodeIds.size === 0) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      let next = documentRef.current;
      for (const nodeId of selectedNodeIds) next = removeNode(next, nodeId);
      setSelectedNodeIds(new Set());
      void persistRef.current(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNodeIds]);

  const persist = async (next: CanvasDocument): Promise<void> => {
    setDocument(next);
    if (!bridge) return;
    writeChainRef.current = writeChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const result = await bridge.writeCanvas(canvasPath, serializeCanvas(next));
        setStatus(result.ok ? 'Saved' : `Save failed: ${result.error.message}`);
      });
    await writeChainRef.current;
  };
  persistRef.current = (next) => { void persist(next); };

  const preview = (next: CanvasDocument): void => setDocument(next);

  const capture = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishGesture = (): void => {
    if (!gesture) return;
    setGesture(null);
    void persist(documentRef.current);
  };

  const worldPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const viewport = documentRef.current.viewport;
    return { x: (clientX - rect.left - viewport.x) / viewport.zoom, y: (clientY - rect.top - viewport.y) / viewport.zoom };
  };

  const addText = (): void => {
    const id = `text-${Date.now()}`;
    void persist(addNode(document, { kind: 'text', id, text: 'New idea', position: { x: 120, y: 100 }, size: { width: 180, height: 100 } }));
  };

  const addNote = (): void => {
    const notePath = store.getState().activePath;
    if (!notePath) {
      setStatus('Open a note before adding it to the canvas');
      return;
    }
    const id = `note-${Date.now()}`;
    void persist(addNode(document, { kind: 'note', id, path: notePath, label: notePath.split('/').pop(), position: { x: 180, y: 180 }, size: { width: 220, height: 120 } }));
  };

  const connectSelected = (): void => {
    const selected = [...selectedNodeIds];
    if (selected.length !== 2) {
      setStatus('Select exactly two nodes to connect');
      return;
    }
    try {
      void persist(addEdge(document, { id: `edge-${Date.now()}`, source: selected[0]!, target: selected[1]! }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Cannot connect nodes');
    }
  };

  const selectNode = (nodeId: string, toggle: boolean): void => {
    setSelectedNodeIds((current) => {
      if (!toggle) return new Set([nodeId]);
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleBoardPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('.canvas-node')) return;
    capture(event);
    setSelectedNodeIds(new Set());
    setGesture({ kind: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, viewport: document.viewport });
  };

  const handleNodePointerDown = (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode): void => {
    event.stopPropagation();
    capture(event);
    selectNode(node.id, event.shiftKey || event.ctrlKey || event.metaKey);
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    setGesture({ kind: 'move', pointerId: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY, position: node.position });
  };

  const handleResizePointerDown = (event: React.PointerEvent<HTMLButtonElement>, node: CanvasNode): void => {
    event.stopPropagation();
    boardRef.current?.setPointerCapture(event.pointerId);
    setSelectedNodeIds(new Set([node.id]));
    setGesture({ kind: 'resize', pointerId: event.pointerId, nodeId: node.id, startX: event.clientX, startY: event.clientY, size: node.size });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const current = documentRef.current;
    if (gesture.kind === 'pan') {
      preview(updateViewport(current, { x: gesture.viewport.x + event.clientX - gesture.startX, y: gesture.viewport.y + event.clientY - gesture.startY }));
      return;
    }
    const scale = current.viewport.zoom;
    if (gesture.kind === 'move') {
      preview(updateNode(current, gesture.nodeId, { position: { x: gesture.position.x + (event.clientX - gesture.startX) / scale, y: gesture.position.y + (event.clientY - gesture.startY) / scale } }));
      return;
    }
    preview(updateNode(current, gesture.nodeId, { size: { width: Math.max(MIN_NODE_WIDTH, gesture.size.width + (event.clientX - gesture.startX) / scale), height: Math.max(MIN_NODE_HEIGHT, gesture.size.height + (event.clientY - gesture.startY) / scale) } }));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    const point = worldPoint(event.clientX, event.clientY);
    if (!point) return;
    const current = documentRef.current;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.viewport.zoom - event.deltaY * 0.001));
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = updateViewport(current, { zoom, x: event.clientX - rect.left - point.x * zoom, y: event.clientY - rect.top - point.y * zoom });
    preview(next);
    void persist(next);
  };

  if (!sessionRoot) return <div className="canvas canvas--empty">Open a vault to use Canvas.</div>;
  return (
    <div className="canvas">
      <div className="canvas__toolbar">
        <input value={canvasPath} onChange={(event) => setCanvasPath(event.target.value)} aria-label="Canvas path" />
        <button type="button" className="btn btn--small" onClick={addNote}>+ Active note</button>
        <button type="button" className="btn btn--small" onClick={addText}>+ Text</button>
        <button type="button" className="btn btn--small" onClick={connectSelected}>Connect selected</button>
        <button type="button" className="btn btn--small" onClick={() => void persist(updateViewport(document, { zoom: Math.min(MAX_ZOOM, document.viewport.zoom + 0.1) }))}>＋</button>
        <button type="button" className="btn btn--small" onClick={() => void persist(updateViewport(document, { zoom: Math.max(MIN_ZOOM, document.viewport.zoom - 0.1) }))}>－</button>
        <span className="canvas__status">{status} · {selectedNodeIds.size} selected</span>
      </div>
      <div className={`canvas__board${gesture?.kind === 'pan' ? ' is-panning' : ''}`} ref={boardRef} style={{ backgroundPosition: `${document.viewport.x}px ${document.viewport.y}px`, backgroundSize: `${20 * document.viewport.zoom}px ${20 * document.viewport.zoom}px` }} onPointerDown={handleBoardPointerDown} onPointerMove={handlePointerMove} onPointerUp={finishGesture} onPointerCancel={finishGesture} onWheel={handleWheel}>
        <div className="canvas__world" style={{ transform: `translate(${document.viewport.x}px, ${document.viewport.y}px) scale(${document.viewport.zoom})` }}>
          <svg className="canvas__edges" aria-hidden="true">
            {document.edges.map((edge) => {
              const source = nodeMap.get(edge.source); const target = nodeMap.get(edge.target);
              if (!source || !target) return null;
              return <line key={edge.id} x1={source.position.x + source.size.width / 2} y1={source.position.y + source.size.height / 2} x2={target.position.x + target.size.width / 2} y2={target.position.y + target.size.height / 2} stroke="var(--accent)" strokeWidth="2" markerEnd="url(#arrow)" />;
            })}
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="var(--accent)" /></marker></defs>
          </svg>
          {document.nodes.map((node) => <CanvasNodeView key={node.id} node={node} selected={selectedNodeIds.has(node.id)} onDelete={(id) => { setSelectedNodeIds((current) => { const next = new Set(current); next.delete(id); return next; }); void persist(removeNode(documentRef.current, id)); }} onPointerDown={handleNodePointerDown} onResizePointerDown={handleResizePointerDown} />)}
        </div>
      </div>
    </div>
  );
}

interface CanvasNodeViewProps {
  readonly node: CanvasNode;
  readonly selected: boolean;
  readonly onDelete: (id: string) => void;
  readonly onPointerDown: (event: React.PointerEvent<HTMLDivElement>, node: CanvasNode) => void;
  readonly onResizePointerDown: (event: React.PointerEvent<HTMLButtonElement>, node: CanvasNode) => void;
}

function CanvasNodeView({ node, selected, onDelete, onPointerDown, onResizePointerDown }: CanvasNodeViewProps): React.JSX.Element {
  const body = node.kind === 'note' ? node.label ?? node.path : node.kind === 'text' ? node.text : node.kind === 'image' ? node.alt ?? node.path : node.kind === 'group' ? node.label ?? 'Group' : node.label ?? node.url;
  return <div className={`canvas-node canvas-node--${node.kind}${selected ? ' is-selected' : ''}`} role="group" aria-label={`${node.kind} node`} aria-selected={selected} style={{ left: node.position.x, top: node.position.y, width: node.size.width, height: node.size.height }} onPointerDown={(event) => onPointerDown(event, node)}>
    <div className="canvas-node__header"><span>{node.kind === 'note' ? '📝' : '▦'} {node.kind}</span><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onDelete(node.id); }}>×</button></div>
    <div className="canvas-node__body">{body}</div>
    {selected && <button type="button" className="canvas-node__resize" aria-label="Resize node" onPointerDown={(event) => onResizePointerDown(event, node)} />}
  </div>;
}
