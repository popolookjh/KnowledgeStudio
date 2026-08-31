import { useEffect } from 'react';
import { store, useAppState } from '../state/store';

/** Bottom status bar: session, active note, save state, errors. */
export function StatusBar(): React.JSX.Element {
  const { sessionRoot, tabs, activePath, status, mode, watcherActive } = useAppState();
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const dirty = activeTab ? activeTab.content !== activeTab.savedContent : false;

  useEffect(() => {
    if (status?.tone === 'info' && status.message) {
      const timer = setTimeout(() => store.clearStatus(), 4000);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [status]);

  return (
    <footer className="statusbar">
      <span className="statusbar__cell">
        {sessionRoot ? 'Vault connected' : 'No vault'}
      </span>
      <span className="statusbar__cell">{watcherActive ? 'Watching' : ''}</span>
      <span className="statusbar__cell statusbar__grow" title={activeTab?.path ?? ''}>
        {activeTab ? activeTab.path : ''}
      </span>
      <span className="statusbar__cell">{activeTab ? (dirty ? 'Unsaved' : 'Saved') : ''}</span>
      <span className="statusbar__cell">{activeTab ? `Mode: ${mode}` : ''}</span>
      <span
        className={`statusbar__cell statusbar__status${
          status?.tone === 'error' ? ' statusbar__status--error' : ''
        }`}
      >
        {status?.message ?? 'Ready'}
      </span>
    </footer>
  );
}
