import { useEffect, useRef, useState } from 'react';
import type { SearchHitDto } from '../../shared/ipc-contract';
import { store, useAppState } from '../state/store';

/**
 * Search overlay (Phase 5): FTS5-backed full-text search over the vault,
 * opened with Ctrl/Cmd-P or the toolbar button. Keyboard navigable;
 * Enter opens the selected hit.
 */

export function SearchOverlay(): React.JSX.Element | null {
  const { sessionRoot, bridge } = useAppState();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHitDto[]>([]);
  const [selected, setSelected] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (sessionRoot) {
          setOpen((value) => !value);
        }
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionRoot]);

  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !bridge) {
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHits([]);
      setError(null);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void bridge
        .search(trimmed)
        .then((result) => {
          if (result.ok) {
            setHits(result.value);
            setSelected(0);
            setError(null);
          } else {
            setHits([]);
            setError(result.error.message);
          }
        })
        .catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => setSearching(false));
    }, 150);
    return () => clearTimeout(timer);
  }, [query, open, bridge]);

  if (!open || !sessionRoot) {
    return null;
  }

  const openHit = (hit: SearchHitDto): void => {
    setOpen(false);
    setQuery('');
    void store.openNote(hit.path);
  };

  return (
    <div className="search-overlay" onClick={() => setOpen(false)}>
      <div className="search-overlay__panel" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-overlay__input"
          placeholder="Search the vault…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((value) => Math.min(value + 1, hits.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((value) => Math.max(value - 1, 0));
            }
            if (event.key === 'Enter') {
              const hit = hits[selected];
              if (hit) {
                openHit(hit);
              }
            }
          }}
        />
        {error && <div className="search-overlay__error">{error}</div>}
        <ul className="search-overlay__hits" role="listbox">
          {hits.map((hit, index) => (
            <li
              key={hit.path}
              role="option"
              aria-selected={index === selected}
              className={`search-overlay__hit${index === selected ? ' is-selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => openHit(hit)}
            >
              <span className="search-overlay__hit-title">{hit.title}</span>
              <span className="search-overlay__hit-path">{hit.path}</span>
              {hit.snippet.length > 0 && (
                <span
                  className="search-overlay__hit-snippet"
                  dangerouslySetInnerHTML={{ __html: hit.snippet }}
                />
              )}
            </li>
          ))}
          {hits.length === 0 && query.trim().length > 0 && !searching && !error && (
            <li className="search-overlay__empty">No matches.</li>
          )}
        </ul>
        <div className="search-overlay__hint">↑↓ navigate · Enter open · Esc close</div>
      </div>
    </div>
  );
}
