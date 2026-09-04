import { useEffect, useMemo, useState } from 'react';
import type { RevisionDto } from '../../shared/ipc-contract';
import { store, useAppState } from '../state/store';

type DiffLine = { readonly kind: 'same' | 'added' | 'removed'; readonly text: string; readonly line: number };

/** Pure renderer-side preview only; history filesystem access stays in main. */
function diffText(before: string, after: string): readonly DiffLine[] {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  const result: DiffLine[] = [];
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const previous = left[index];
    const current = right[index];
    if (previous === current && previous !== undefined) {
      result.push({ kind: 'same', text: previous, line: index + 1 });
    } else {
      if (previous !== undefined) result.push({ kind: 'removed', text: previous, line: index + 1 });
      if (current !== undefined) result.push({ kind: 'added', text: current, line: index + 1 });
    }
  }
  return result;
}

function formatRevision(revision: RevisionDto): string {
  return `${new Date(revision.createdAt).toLocaleString()} · ${revision.bytes.toLocaleString()} bytes`;
}

/** Active-note local revision surface. Restore always asks for confirmation. */
export function HistoryPanel(): React.JSX.Element {
  const { bridge, tabs, activePath } = useAppState();
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const [revisions, setRevisions] = useState<readonly RevisionDto[]>([]);
  const [selected, setSelected] = useState<RevisionDto | null>(null);
  const [diff, setDiff] = useState<readonly DiffLine[]>([]);
  const [pendingRestore, setPendingRestore] = useState<RevisionDto | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge || !activeTab) {
      setRevisions([]);
      setSelected(null);
      setDiff([]);
      return;
    }
    void bridge.listHistory(activeTab.path).then((result) => {
      if (result.ok) {
        setRevisions(result.value);
        setStatus(null);
      } else {
        setRevisions([]);
        setStatus(result.error.message);
      }
    });
  }, [bridge, activeTab]);

  const selectedId = selected?.id ?? null;
  const canRestore = activeTab !== null && pendingRestore !== null;
  const currentContent = activeTab?.content ?? '';

  const inspect = async (revision: RevisionDto): Promise<void> => {
    if (!bridge || !activeTab) return;
    const result = await bridge.readHistory(activeTab.path, revision.id);
    if (!result.ok) {
      setStatus(result.error.message);
      return;
    }
    setSelected(revision);
    setDiff(diffText(result.value, currentContent));
    setStatus(null);
  };

  const confirmRestore = async (): Promise<void> => {
    if (!pendingRestore || !activeTab) return;
    const restored = await store.restoreHistoryRevision(activeTab.path, pendingRestore.id);
    setStatus(restored ? `Restored revision from ${formatRevision(pendingRestore)}` : 'Restore did not complete');
    setPendingRestore(null);
    if (restored && bridge) {
      const result = await bridge.listHistory(activeTab.path);
      if (result.ok) setRevisions(result.value);
    }
  };

  const summary = useMemo(() => {
    if (!activeTab) return 'Open a note to view its local revision history.';
    if (revisions.length === 0) return 'No saved revisions yet. Revisions are created before changed notes are saved.';
    return `${revisions.length} saved revision${revisions.length === 1 ? '' : 's'}`;
  }, [activeTab, revisions.length]);

  return (
    <section className="rightbar__section history-panel">
      <h3 className="rightbar__heading">History</h3>
      <p className="rightbar__hint">{summary}</p>
      {status && <p className="history-panel__status" role="status">{status}</p>}
      {revisions.length > 0 && (
        <ul className="history-panel__list">
          {revisions.map((revision) => (
            <li key={revision.id} className={revision.id === selectedId ? 'is-selected' : ''}>
              <button type="button" className="history-panel__revision" onClick={() => void inspect(revision)}>
                {formatRevision(revision)}
              </button>
              <button type="button" className="history-panel__restore" onClick={() => setPendingRestore(revision)}>
                Restore…
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="history-panel__diff" aria-label={`Diff for ${formatRevision(selected)}`}>
          <strong>Diff against current buffer</strong>
          {diff.map((line, index) => (
            <pre key={`${line.line}:${index}`} className={`history-panel__diff-line history-panel__diff-line--${line.kind}`}>
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} {line.text}
            </pre>
          ))}
        </div>
      )}
      {pendingRestore && (
        <div className="history-panel__confirm" role="alertdialog" aria-label="Confirm revision restore">
          <p>Replace the active note with this saved revision? Current content will first become a new revision.</p>
          <button type="button" className="btn btn--small btn--primary" onClick={() => void confirmRestore()} disabled={!canRestore}>
            Confirm restore
          </button>
          <button type="button" className="btn btn--small" onClick={() => setPendingRestore(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
