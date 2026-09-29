import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer, VerbosityLevel, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfAnnotationColor, PdfAnnotationsDto } from '../../shared/ipc-contract';
import { store } from '../state/store';

/**
 * PDF reader + annotations (Phase 35). The PDF arrives as bytes from the
 * trusted main-process PdfHost; pdf.js parses it in a bundled same-origin
 * worker with WebAssembly and XFA disabled. Only the canvas and a text
 * layer are rendered — PDF links, forms, and scripts are never activated.
 */

GlobalWorkerOptions.workerSrc = workerUrl;
const COLORS: readonly PdfAnnotationColor[] = ['yellow', 'green', 'blue', 'pink'];

export function PdfView({ path }: { readonly path: string }): React.JSX.Element {
  const api = window.knowledgeStudio ?? null;
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [title, setTitle] = useState<string>(path.replace(/^.*\//, '').replace(/\.pdf$/i, ''));
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.25);
  const [annotations, setAnnotations] = useState<PdfAnnotationsDto | null>(null);
  const [color, setColor] = useState<PdfAnnotationColor>('yellow');
  const [status, setStatus] = useState('Loading PDF…');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let task: ReturnType<typeof getDocument> | null = null;
    void (async () => {
      const [read, listed] = await Promise.all([api.pdfRead(path), api.pdfAnnotationsList(path)]);
      if (cancelled) return;
      if (!read.ok) { setStatus(`Cannot open PDF: ${read.error.message}`); return; }
      if (listed.ok) setAnnotations(listed.value);
      try {
        task = getDocument({ data: read.value.bytes, useWasm: false, enableXfa: false, isOffscreenCanvasSupported: false, verbosity: VerbosityLevel.ERRORS });
        const loaded = await task.promise;
        if (cancelled) return;
        const info = await loaded.getMetadata().catch(() => null);
        const infoRecord: unknown = info?.info;
        const infoTitle = typeof infoRecord === 'object' && infoRecord !== null ? (infoRecord as Record<string, unknown>)['Title'] : undefined;
        if (typeof infoTitle === 'string' && infoTitle.trim()) setTitle(infoTitle.trim());
        setDoc(loaded);
        setStatus(`${loaded.numPages} pages`);
      } catch (error) {
        setStatus(`Cannot parse PDF: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => { cancelled = true; if (task) void task.destroy(); };
  }, [api, path]);

  useEffect(() => {
    if (!doc || !canvasRef.current || !textRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const textContainer = textRef.current;
    let textLayer: TextLayer | null = null;
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await pdfPage.render({ canvas, viewport }).promise.catch(() => undefined);
      if (cancelled) return;
      textContainer.replaceChildren();
      textContainer.style.setProperty('--total-scale-factor', String(scale));
      textContainer.style.width = `${Math.floor(viewport.width)}px`;
      textContainer.style.height = `${Math.floor(viewport.height)}px`;
      textLayer = new TextLayer({ textContentSource: await pdfPage.getTextContent(), container: textContainer, viewport });
      await textLayer.render();
    })();
    return () => { cancelled = true; textLayer?.cancel(); };
  }, [doc, page, scale]);

  // Visually mark text-layer spans that belong to this page's highlights.
  useEffect(() => {
    const container = textRef.current;
    if (!container || !annotations) return;
    const quotes = annotations.annotations.filter((annotation) => annotation.page === page);
    for (const span of Array.from(container.querySelectorAll('span'))) {
      const text = span.textContent?.trim() ?? '';
      const match = text.length > 1 ? quotes.find((annotation) => annotation.quote.includes(text)) : undefined;
      span.dataset['highlight'] = match ? match.color : '';
    }
  });

  const addFromSelection = useCallback(async (): Promise<void> => {
    if (!api || !annotations) return;
    const selection = window.getSelection();
    const quote = selection && textRef.current && selection.anchorNode && textRef.current.contains(selection.anchorNode) ? selection.toString() : '';
    if (!quote.trim()) { setStatus('Select text on the page first'); return; }
    const added = await api.pdfAnnotationAdd(path, { page, quote, color }, annotations.revision, title);
    if (!added.ok) { setStatus(`Highlight failed: ${added.error.message}`); return; }
    selection?.removeAllRanges();
    setAnnotations(added.value);
    setStatus(`Highlighted on page ${page}`);
  }, [api, annotations, color, page, path, title]);

  const saveNote = async (id: string): Promise<void> => {
    if (!api || !annotations) return;
    const updated = await api.pdfAnnotationUpdate(path, id, { note: notes[id] ?? '' }, annotations.revision);
    if (updated.ok) { setAnnotations(updated.value); setStatus('Note saved'); } else setStatus(`Save failed: ${updated.error.message}`);
  };

  const remove = async (id: string): Promise<void> => {
    if (!api || !annotations) return;
    const removed = await api.pdfAnnotationRemove(path, id, annotations.revision);
    if (removed.ok) { setAnnotations(removed.value); setStatus('Annotation deleted'); } else setStatus(`Delete failed: ${removed.error.message}`);
  };

  const exportNote = async (): Promise<void> => {
    if (!api) return;
    const exported = await api.pdfExportNote(path, title);
    if (!exported.ok) { setStatus(`Export failed: ${exported.error.message}`); return; }
    await store.refreshEntries();
    await store.openNote(exported.value.path);
    store.closePdf();
  };

  const pageCount = doc?.numPages ?? 0;
  return (
    <div
      className="pdf"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
        if (event.key === 'PageDown') { event.preventDefault(); setPage((current) => Math.min(pageCount || 1, current + 1)); }
        if (event.key === 'PageUp') { event.preventDefault(); setPage((current) => Math.max(1, current - 1)); }
      }}
    >
      <div className="pdf__toolbar" role="toolbar" aria-label="PDF controls">
        <button type="button" className="btn btn--small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous page</button>
        <span aria-live="polite">Page {page} / {pageCount || '…'}</span>
        <button type="button" className="btn btn--small" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next page</button>
        <button type="button" className="btn btn--small" aria-label="Zoom out" onClick={() => setScale((current) => Math.max(0.5, current - 0.25))}>−</button>
        <button type="button" className="btn btn--small" aria-label="Zoom in" onClick={() => setScale((current) => Math.min(3, current + 0.25))}>+</button>
        <label className="pdf__color">Color
          <select value={color} onChange={(event) => setColor(event.target.value as PdfAnnotationColor)}>
            {COLORS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn--small btn--primary" onClick={() => void addFromSelection()}>Highlight selection</button>
        <button type="button" className="btn btn--small" disabled={!annotations || annotations.annotations.length === 0} onClick={() => void exportNote()}>Export to note</button>
      </div>
      <div className="pdf__body">
        <div className="pdf__viewport" tabIndex={0} aria-label={`${title}, page ${page}`}>
          <div className="pdf__page">
            <canvas ref={canvasRef} aria-hidden="true" />
            <div ref={textRef} className="textLayer" dir="auto" />
          </div>
        </div>
        <aside className="pdf__annotations" aria-label="Annotations">
          <h4>Annotations ({annotations?.annotations.length ?? 0})</h4>
          <ol>
            {annotations?.annotations.map((annotation) => (
              <li key={annotation.id} className={`pdf__annotation pdf__annotation--${annotation.color}`}>
                <button type="button" className="pdf__jump" onClick={() => setPage(annotation.page)}>p. {annotation.page}</button>
                <blockquote dir="auto">{annotation.quote}</blockquote>
                <label className="pdf__note">Note
                  <textarea dir="auto" rows={2} value={notes[annotation.id] ?? annotation.note ?? ''} onChange={(event) => setNotes({ ...notes, [annotation.id]: event.target.value })} />
                </label>
                <div className="pdf__annotation-actions">
                  <button type="button" className="btn btn--small" onClick={() => void saveNote(annotation.id)}>Save note</button>
                  <button type="button" className="btn btn--small" onClick={() => void remove(annotation.id)}>Delete</button>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <p className="pdf__status" role="status">{status}</p>
    </div>
  );
}
