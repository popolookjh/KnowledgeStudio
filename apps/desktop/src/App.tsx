import { useEffect } from 'react';
import { EditorPane } from './components/EditorPane';
import { Explorer } from './components/Explorer';
import { PreviewPane } from './components/PreviewPane';
import { RightSidebar } from './components/RightSidebar';
import { StatusBar } from './components/StatusBar';
import { TabsBar } from './components/TabsBar';
import { WelcomeView } from './components/WelcomeView';
import { store, useAppState } from './state/store';

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
  const { sessionRoot, mode, activePath, conflictPath } = useAppState();

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
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'p') {
        // Command palette placeholder shortcut; palette lands in Phase 10.
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
    </div>
  );
}
