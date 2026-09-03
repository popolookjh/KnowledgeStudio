import { useSyncExternalStore, useMemo } from 'react';
import { linkIndex } from '../state/linkIndex';
import { noteTitleFromPath } from '../../shared/ipc-contract';

/**
 * Global knowledge graph (Phase 6): nodes are notes, edges are resolved
 * wiki/markdown links. Data comes straight from the renderer link index —
 * the graph is a *visualization over actual relationships*, never an
 * independent source of truth (ADR-0003).
 *
 * Rendered with Cytoscape.js; node click opens the note.
 */

interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly degree: number;
}

interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

function buildGraphData(): GraphData {
  const nodeSet = new Map<string, number>();
  const edgeMap = new Map<string, GraphEdge>();
  // Every indexed note is a node, even isolated ones.
  for (const path of linkIndex.allPaths()) {
    nodeSet.set(path, 0);
  }
  const seenPairs = new Set<string>();
  for (const path of linkIndex.allPaths()) {
    for (const reference of linkIndex.backlinksOf(path)) {
      if (reference.source === path) {
        continue; // skip self-loops
      }
      const edge: GraphEdge = { id: `${reference.source}->${path}`, source: reference.source, target: path };
      const pairKey = edge.id;
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      edgeMap.set(pairKey, edge);
      nodeSet.set(path, (nodeSet.get(path) ?? 0) + 1);
      nodeSet.set(reference.source, (nodeSet.get(reference.source) ?? 0) + 1);
    }
  }
  return {
    nodes: [...nodeSet.entries()].map(([id, degree]) => ({
      id,
      label: noteTitleFromPath(id),
      degree,
    })),
    edges: [...edgeMap.values()],
  };
}

export function useGraphData(): GraphData {
  useSyncExternalStore(linkIndex.subscribe, linkIndex.getSnapshot, linkIndex.getSnapshot);
  return useMemo(buildGraphData, [linkIndex.getSnapshot().version]);
}
