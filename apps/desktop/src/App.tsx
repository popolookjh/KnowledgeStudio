import { lazy, Suspense, useEffect } from 'react';
import { EditorPane } from './components/EditorPane';
import { Explorer } from './components/Explorer';
import { OptionalViewBoundary } from './components/OptionalViewBoundary';
import { PreviewPane } from './components/PreviewPane';
import { RightSidebar } from './components/RightSidebar';
import { SearchOverlay } from './components/SearchOverlay';
import { StatusBar } from './components/StatusBar';
import { TabsBar } from './components/TabsBar';
import { WelcomeView } from './components/WelcomeView';
import { store, useAppState } from './state/store';

const LazyGraphView = lazy(async () => {
  const module = await import('./components/GraphView');
  return { default: module.GraphView };
});

const LazyBasesView = lazy(async () => {
  const module = await import('./components/BasesView');
  return { default: module.BasesView };
});

const LazyPdfView = lazy(async () => {
  const module = await import('./components/PdfView');
  return { default: module.PdfView };
});

const LazyCanvasView = lazy(async () => {
  const module = await import('./components/CanvasView');
  return { default: module.CanvasView };
});

function OptionalViewLoading({ name }: { readonly name: string }): React.JSX.Element {
  return <div className="optional-view-fallback" role="status">Loading {name}…</div>;
}

/**
 * Application layout:
 *
 * ┌──────────────────────────────────────────────────────┐
 * │ titlebar (brand + vault actions + mode switch)       │
 * ├───────────┬──────────────────────────────┬───────────┤
 * │ explorer  │ tabs / editor (+ preview)    │ props +   │
 * │ (left)    │                              │ outline   │
 * ├───────────┴──────────────────────────────┴───────────┤
 * │ status bar                                           │
 * └──────────────────────────────────────────────────────┘
 */
export default function App(): React.JSX.Element {
  const { sessionRoot, mode, activePath, conflictPath, graphOpen, canvasOpen, basesOpen, pdfPath } = useAppState();

  useEffect(() => {
    void store.bootstrap();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (activePath) {
          void store.saveNote(activePath);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePath]);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <span className="titlebar__brand">Knowledge Studio</span>
        {sessionRoot && (
          <>
            <span className="titlebar__vault" title={sessionRoot}>
              {sessionRoot}
            </span>
            <div className="titlebar__actions">
              <button
                type="button"
                className="btn btn--small"
                title="Search the vault (Ctrl+P)"
                onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true }))}
              >
                Search
              </button>
              <button
                type="button"
                className="btn btn--small"
                title="Open the knowledge graph"
                onClick={() => store.openGraph()}
              >
                Graph
              </button>
              <button
                type="button"
                className="btn btn--small"
                title="Open a visual canvas"
                onClick={() => store.openCanvas()}
              >
                Canvas
              </button>
              <button
                type="button"
                className="btn btn--small"
                title="Open metadata Bases (table, cards, Kanban)"
                onClick={() => store.openBases()}
              >
                Bases
              </button>
              <button
                type="button"
                className="btn btn--small"
                title="Rebuild the search index from Markdown"
                onClick={() => void store.rebuildIndex()}
              >
                Rebuild index
              </button>
              <button
                type="button"
                className="btn btn--small"
                title="Add an attachment to the active note"
                onClick={() => { if (activePath) void store.addAttachment(activePath); }}
                disabled={!activePath}
              >
                Add attachment
              </button>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => void store.createNoteInFolder('')}
              >
                New note
              </button>
              <div className="titlebar__modes" role="group" aria-label="Editor mode">
                {(['edit', 'split', 'preview'] as const).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={`btn btn--small${mode === candidate ? ' is-active' : ''}`}
                    onClick={() => store.setMode(candidate)}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn--small" onClick={() => void store.closeVault()}>
                Close vault
              </button>
            </div>
          </>
        )}
      </header>
      {sessionRoot ? (
        <div className="workbench">
          <Explorer />
          <main className="center">
            <TabsBar />
            {conflictPath && (
              <div className="conflict" role="alert">
                <span>
                  This file changed on disk while you were editing it. Keep your version or load
                  the file from the vault?
                </span>
                <div className="conflict__actions">
                  <button
                    type="button"
                    className="btn btn--small btn--primary"
                    onClick={() => void store.overwriteFromEditor(conflictPath)}
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    className="btn btn--small"
                    onClick={() => void store.reloadFromDisk(conflictPath)}
                  >
                    Load from disk
                  </button>
                </div>
              </div>
            )}
            <div
              className={`center__panes${
                mode === 'split' ? ' center__panes--split' : ''
              }`}
            >
              {mode !== 'preview' && <EditorPane />}
              {(mode === 'split' || mode === 'preview') && <PreviewPane />}
            </div>
          </main>
          <RightSidebar />
        </div>
      ) : (
        <main className="app-shell__main">
          <WelcomeView />
        </main>
      )}
      <StatusBar />
      <SearchOverlay />
      {graphOpen && (
        <OptionalViewBoundary name="Knowledge graph" onClose={() => store.closeGraph()}>
          <Suspense fallback={<OptionalViewLoading name="Knowledge graph" />}>
            <LazyGraphView />
          </Suspense>
        </OptionalViewBoundary>
      )}
      {pdfPath && (
        <div className="canvas-overlay" onClick={() => store.closePdf()}>
          <div className="canvas-overlay__panel" role="dialog" aria-modal="true" aria-label="PDF reader" onClick={(event) => event.stopPropagation()}>
            <div className="canvas-overlay__header">
              <span dir="auto">{pdfPath}</span>
              <button type="button" className="btn btn--small" onClick={() => store.closePdf()}>Close</button>
            </div>
            <OptionalViewBoundary name="PDF reader" onClose={() => store.closePdf()}>
              <Suspense fallback={<OptionalViewLoading name="PDF reader" />}>
                <LazyPdfView key={pdfPath} path={pdfPath} />
              </Suspense>
            </OptionalViewBoundary>
          </div>
        </div>
      )}
      {basesOpen && (
        <div className="canvas-overlay" onClick={() => store.closeBases()}>
          <div
            className="canvas-overlay__panel"
            role="dialog"
            aria-modal="true"
            aria-label="Bases"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => { if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) store.closeBases(); }}
          >
            <div className="canvas-overlay__header">
              <span>Bases</span>
              <button type="button" className="btn btn--small" onClick={() => store.closeBases()}>Close</button>
            </div>
            <OptionalViewBoundary name="Bases" onClose={() => store.closeBases()}>
              <Suspense fallback={<OptionalViewLoading name="Bases" />}>
                <LazyBasesView />
              </Suspense>
            </OptionalViewBoundary>
          </div>
        </div>
      )}
      {canvasOpen && (
        <div className="canvas-overlay" onClick={() => store.closeCanvas()}>
          <div className="canvas-overlay__panel" onClick={(event) => event.stopPropagation()}>
            <div className="canvas-overlay__header">
              <span>Canvas board</span>
              <button type="button" className="btn btn--small" onClick={() => store.closeCanvas()}>Close</button>
            </div>
            <OptionalViewBoundary name="Canvas board" onClose={() => store.closeCanvas()}>
              <Suspense fallback={<OptionalViewLoading name="Canvas board" />}>
                <LazyCanvasView />
              </Suspense>
            </OptionalViewBoundary>
          </div>
        </div>
      )}
    </div>
  );
}
