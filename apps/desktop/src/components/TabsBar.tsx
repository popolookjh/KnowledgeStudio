import { useAppState, store } from '../state/store';

/** Tab strip above the editor; shows unsaved state per tab. */
export function TabsBar(): React.JSX.Element {
  const { tabs, activePath, conflictPath } = useAppState();
  if (tabs.length === 0) {
    return <div className="tabs tabs--empty" />;
  }
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => {
        const dirty = tab.content !== tab.savedContent;
        const conflicted = tab.path === conflictPath;
        return (
          <button
            key={tab.path}
            type="button"
            role="tab"
            aria-selected={tab.path === activePath}
            className={`tabs__tab${tab.path === activePath ? ' is-active' : ''}`}
            title={tab.path}
            onClick={() => store.setActiveTab(tab.path)}
          >
            <span className="tabs__title">
              {tab.title}
              {conflicted && <span className="tabs__conflict" title="Changed on disk"> ⚠</span>}
            </span>
            <span
              className={`tabs__dirty${dirty ? ' is-dirty' : ''}`}
              aria-label={dirty ? 'Unsaved changes' : 'Saved'}
            >
              ●
            </span>
            <span
              className="tabs__close"
              role="button"
              tabIndex={-1}
              title="Close tab"
              onClick={(event) => {
                event.stopPropagation();
                store.closeTab(tab.path);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.stopPropagation();
                  store.closeTab(tab.path);
                }
              }}
            >
              ×
            </span>
          </button>
        );
      })}
    </div>
  );
}
