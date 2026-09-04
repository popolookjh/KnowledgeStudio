import { z } from 'zod';

/**
 * Knowledge Studio Canvas format (`.ks-canvas.json`). Original, local,
 * human-readable JSON — not derived from or compatible with another product.
 * Nodes reference notes by vault-relative path; the board remains useful as
 * plain JSON even without the application.
 */

export const CanvasPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
export const CanvasSizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });

const BaseNodeSchema = z.object({
  id: z.string().min(1),
  position: CanvasPointSchema,
  size: CanvasSizeSchema,
  color: z.string().optional(),
});

export const CanvasNodeSchema = z.discriminatedUnion('kind', [
  BaseNodeSchema.extend({ kind: z.literal('note'), path: z.string().min(1), label: z.string().optional() }),
  BaseNodeSchema.extend({ kind: z.literal('text'), text: z.string() }),
  BaseNodeSchema.extend({ kind: z.literal('image'), path: z.string().min(1), alt: z.string().optional() }),
  BaseNodeSchema.extend({ kind: z.literal('group'), label: z.string().optional(), childIds: z.array(z.string()) }),
  BaseNodeSchema.extend({ kind: z.literal('link'), url: z.string().url(), label: z.string().optional() }),
]);

export const CanvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().optional(),
  color: z.string().optional(),
});

const CanvasViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().positive().finite(),
});

export const CanvasDocumentSchema = z.object({
  format: z.literal('knowledge-studio.canvas'),
  version: z.literal(1),
  title: z.string().default('Untitled canvas'),
  viewport: CanvasViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
  nodes: z.array(CanvasNodeSchema).default([]),
  edges: z.array(CanvasEdgeSchema).default([]),
});

export type CanvasPoint = z.infer<typeof CanvasPointSchema>;
export type CanvasSize = z.infer<typeof CanvasSizeSchema>;
export type CanvasViewport = z.infer<typeof CanvasViewportSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
export type CanvasDocument = z.infer<typeof CanvasDocumentSchema>;

export const EMPTY_CANVAS: CanvasDocument = CanvasDocumentSchema.parse({ format: 'knowledge-studio.canvas', version: 1 });

export function parseCanvas(raw: unknown): { ok: true; value: CanvasDocument } | { ok: false; errors: readonly string[] } {
  const result = CanvasDocumentSchema.safeParse(raw);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) };
}

export function serializeCanvas(document: CanvasDocument): string {
  return `${JSON.stringify(CanvasDocumentSchema.parse(document), null, 2)}\n`;
}

export function updateViewport(
  document: CanvasDocument,
  patch: Partial<CanvasViewport>,
): CanvasDocument {
  return { ...document, viewport: CanvasViewportSchema.parse({ ...document.viewport, ...patch }) };
}

export function addNode(document: CanvasDocument, node: CanvasNode): CanvasDocument {
  if (document.nodes.some((candidate) => candidate.id === node.id)) throw new Error(`Canvas node already exists: ${node.id}`);
  return { ...document, nodes: [...document.nodes, node] };
}

export function updateNode(document: CanvasDocument, id: string, patch: Partial<CanvasNode>): CanvasDocument {
  let found = false;
  const nodes = document.nodes.map((node) => {
    if (node.id !== id) return node;
    found = true;
    return CanvasNodeSchema.parse({ ...node, ...patch });
  });
  if (!found) throw new Error(`Canvas node not found: ${id}`);
  return { ...document, nodes };
}

export function removeNode(document: CanvasDocument, id: string): CanvasDocument {
  if (!document.nodes.some((node) => node.id === id)) return document;
  return { ...document, nodes: document.nodes.filter((node) => node.id !== id), edges: document.edges.filter((edge) => edge.source !== id && edge.target !== id) };
}

export function addEdge(document: CanvasDocument, edge: CanvasEdge): CanvasDocument {
  if (!document.nodes.some((node) => node.id === edge.source) || !document.nodes.some((node) => node.id === edge.target)) throw new Error('Canvas edge endpoints must reference existing nodes');
  if (document.edges.some((candidate) => candidate.id === edge.id)) throw new Error(`Canvas edge already exists: ${edge.id}`);
  return { ...document, edges: [...document.edges, edge] };
}
