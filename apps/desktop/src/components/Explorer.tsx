import { useMemo } from 'react';
import type { EntryDto } from '../../shared/ipc-contract';
import { useAppState, store } from '../state/store';

/**
 * Left sidebar: vault file explorer rendered from the flat entry listing.
 * Folders are derived from note/attachment paths (structure, not a tree
 * object), so the view is always consistent with the real filesystem.
 */

interface FolderNode {
  readonly name: string;
  readonly children: EntryDto[];
}

function buildFolders(entries: readonly EntryDto[]): FolderNode[] {
  const folders = new Map<string, EntryDto[]>();
  for (const entry of entries) {
    if (entry.kind === 'folder') {
      continue;
    }
    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    const list = folders.get(dir) ?? [];
    list.push(entry);
    folders.set(dir, list);
  }
  return [...folders.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([dir, children]) => ({ name: dir === '' ? 'Vault root' : dir, children }));
}

function entryIcon(entry: EntryDto): string {
  if (entry.kind === 'note') {
    return '📝';
  }
  if (entry.kind === 'attachment') {
    return '📎';
  }
  return '📄';
}

export function Explorer(): React.JSX.Element {
  const { entries, activePath, sessionRoot } = useAppState();
  const folders = useMemo(() => buildFolders(entries), [entries]);

  if (!sessionRoot) {
    return <div className="explorer explorer--empty">No vault open</div>;
  }

  return (
    <div className="explorer">
      <div className="explorer__header">
        <span className="explorer__title">Vault</span>
        <button
          type="button"
          className="btn btn--small"
          title="Create a note in the vault root"
          onClick={() => void store.createNoteInFolder('')}
        >
          + Note
        </button>
      </div>
      <div className="explorer__tree" role="tree">
        {folders.map((folder) => (
          <div key={folder.name} className="explorer__folder">
            <div className="explorer__folder-name" title={folder.name}>
              {folder.name}
            </div>
            {folder.children.map((entry) => (
              <button
                key={entry.path}
                type="button"
                role="treeitem"
                className={`explorer__item${entry.path === activePath ? ' is-active' : ''}`}
                title={entry.path}
                onClick={() => {
                  if (entry.kind === 'note') {
                    void store.openNote(entry.path);
                  }
                }}
              >
                <span aria-hidden="true">{entryIcon(entry)}</span>
                <span className="explorer__item-name">{entry.name}</span>
                {entry.kind === 'note' && (
                  <span
                    className="explorer__delete"
                    role="button"
                    tabIndex={-1}
                    title="Move to vault trash"
                    onClick={(event) => {
                      event.stopPropagation();
                      void store.deleteNote(entry.path);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                        void store.deleteNote(entry.path);
                      }
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
        {folders.length === 0 && (
          <div className="explorer__hint">No notes yet — create your first one.</div>
        )}
      </div>
    </div>
  );
}
