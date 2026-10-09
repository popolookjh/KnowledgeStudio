import { useState } from 'react';
import { noteTitleFromPath } from '../../shared/ipc-contract';
import { store } from '../state/store';
import { tagIndex, useTagIndexVersion } from '../state/tagIndex';

/** Tag browser sidebar: counts all tags and filters to matching notes. */
export function TagBrowser(): React.JSX.Element {
  useTagIndexVersion();
  const [selected, setSelected] = useState<string | null>(null);
  const tags = tagIndex.tags();
  const paths = selected ? tagIndex.pathsFor(selected) : [];
  return (
    <section className="rightbar__section">
      <h3 className="rightbar__heading">Tags</h3>
      {tags.length === 0 ? (
        <p className="rightbar__hint">No tags in this vault.</p>
      ) : (
        <div className="tag-browser">
          <div className="tag-browser__cloud">
            {tags.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className={`tag-browser__tag${selected === tag ? ' is-selected' : ''}`}
                onClick={() => setSelected(selected === tag ? null : tag)}
              >
                #{tag} <span>{count}</span>
              </button>
            ))}
          </div>
          {selected && (
            <ul className="tag-browser__results">
              {paths.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className="rightbar__link"
                    onClick={() => void store.openNote(path)}
                  >
                    {noteTitleFromPath(path)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
