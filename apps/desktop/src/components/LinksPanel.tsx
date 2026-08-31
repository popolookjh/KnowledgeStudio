import { useSyncExternalStore } from 'react';
import { linkIndex } from '../state/linkIndex';
import { store, useAppState } from '../state/store';
import { noteTitleFromPath } from '../../shared/ipc-contract';

/**
 * Backlinks and unresolved-links panel (Phase 3).
 * Backlinks come from the renderer link index over all vault notes;
 * unresolved links offer one-click note creation.
 */

export function LinksPanel(): React.JSX.Element {
  const { tabs, activePath } = useAppState();
  useSyncExternalStore(linkIndex.subscribe, linkIndex.getSnapshot, linkIndex.getSnapshot);

  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  if (!activeTab) {
    return (
      <section className="rightbar__section">
        <h3 className="rightbar__heading">Links</h3>
        <p className="rightbar__hint">Open a note to see its links.</p>
      </section>
    );
  }

  const backlinks = linkIndex.backlinksOf(activeTab.path);
  const unresolved = linkIndex.unresolvedOf(activeTab.path);

  return (
    <>
      <section className="rightbar__section">
        <h3 className="rightbar__heading">Backlinks ({backlinks.length})</h3>
        {backlinks.length === 0 ? (
          <p className="rightbar__hint">No notes link here yet.</p>
        ) : (
          <ul className="rightbar__links">
            {backlinks.map((reference) => (
              <li key={`${reference.source}:${reference.line}`}>
                <button
                  type="button"
                  className="rightbar__link"
                  title={`From ${reference.source} · line ${reference.line}`}
                  onClick={() => void store.openNote(reference.source)}
                >
                  <span className="rightbar__link-source">
                    {noteTitleFromPath(reference.source)}
                  </span>
                  <span className="rightbar__link-display">→ {reference.display}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rightbar__section">
        <h3 className="rightbar__heading">Unresolved ({unresolved.length})</h3>
        {unresolved.length === 0 ? (
          <p className="rightbar__hint">All links in this note resolve.</p>
        ) : (
          <ul className="rightbar__links">
            {unresolved.map((link) => (
              <li key={`${link.target}#${link.heading ?? ''}`}>
                <button
                  type="button"
                  className="rightbar__link rightbar__link--unresolved"
                  title={`Create "${link.target}${link.heading ? `#${link.heading}` : ''}"`}
                  onClick={() =>
                    void store.createNoteFromLink(link.target, link.heading)
                  }
                >
                  + {link.target}
                  {link.heading ? `#${link.heading}` : ''}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
