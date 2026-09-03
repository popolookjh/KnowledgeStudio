import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import { store } from '../state/store';
import { useGraphData } from './useGraphData';

/**
 * Global graph view (Phase 6). Cytoscape handles layout and pan/zoom;
 * clicking a node opens the note. The graph re-renders whenever the link
 * index version changes.
 */
export function GraphView(): React.JSX.Element {
  const { nodes, edges } = useGraphData();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }
    const instance = cytoscape({
      container: hostRef.current,
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#5aa7e8',
            label: 'data(label)',
            color: '#e6ebf2',
            'font-size': 9,
            'text-valign': 'bottom',
            'text-margin-y': 4,
            width: 'mapData(degree, 0, 12, 12, 34)',
            height: 'mapData(degree, 0, 12, 12, 34)',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.2,
            'line-color': '#4a5464',
            'target-arrow-color': '#4a5464',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
      ],
      layout: { name: 'cose', animate: false, padding: 30 },
    });
    instance.on('tap', 'node', (event) => {
      // Cytoscape's EventObject declares `target` as any; the selector above
      // guarantees this is a node and `.id()` is its documented node API.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const path: string = String(event.target.id());
      void store.openNote(path);
    });
    cyRef.current = instance;
    return () => {
      instance.destroy();
      cyRef.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = cyRef.current;
    if (!instance) {
      return;
    }
    instance.elements().remove();
    instance.add([
      ...nodes.map((node) => ({
        group: 'nodes' as const,
        data: { id: node.id, label: node.label, degree: node.degree },
      })),
      ...edges.map((edge) => ({
        group: 'edges' as const,
        data: { id: edge.id, source: edge.source, target: edge.target },
      })),
    ]);
    instance.layout({ name: 'cose', animate: false, padding: 30 }).run();
  }, [nodes, edges]);

  return (
    <div className="graph-overlay" onClick={() => store.closeGraph()}>
      <div className="graph-overlay__panel" onClick={(event) => event.stopPropagation()}>
        <div className="graph-overlay__header">
          <span>Knowledge graph ({nodes.length} notes · {edges.length} links)</span>
          <button type="button" className="btn btn--small" onClick={() => store.closeGraph()}>
            Close
          </button>
        </div>
        <div className="graph-overlay__canvas" ref={hostRef} />
      </div>
    </div>
  );
}
