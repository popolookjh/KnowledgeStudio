import { useCallback, useEffect, useState } from 'react';
import type { GitStatusDto } from '../../shared/ipc-contract';
import { useAppState } from '../state/store';

/** Optional Git surface. It exposes only status, diff and explicit selected-file commit. */
export function GitPanel(): React.JSX.Element {
  const { bridge, sessionRoot } = useAppState();
  const [status, setStatus] = useState<GitStatusDto | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!bridge || !sessionRoot) return;
    const result = await bridge.gitStatus();
    if (result.ok) {
      setStatus(result.value);
      setSelected(new Set());
      setDiff('');
      setNotice(result.value.error ?? null);
    } else setNotice(result.error.message);
  }, [bridge, sessionRoot]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedPaths = [...selected];
  const inspectDiff = async (): Promise<void> => {
    if (!bridge || selectedPaths.length === 0) return;
    const result = await bridge.gitDiff(selectedPaths);
    if (result.ok) setDiff(result.value.text || 'No unstaged diff for the selected paths.');
    else setNotice(result.error.message);
  };
  const commit = async (): Promise<void> => {
    if (!bridge || selectedPaths.length === 0 || message.trim().length === 0) return;
    const result = await bridge.gitCommitSelected(selectedPaths, message.trim());
    if (result.ok) {
      setNotice(`Committed ${result.value.hash}`);
      setMessage('');
      await refresh();
    } else setNotice(result.error.message);
  };

  return (
    <section className="rightbar__section git-panel">
      <h3 className="rightbar__heading">Git (optional)</h3>
      {!sessionRoot && <p className="rightbar__hint">Open a vault to inspect Git status.</p>}
      {sessionRoot && !status && <button type="button" className="btn btn--small" onClick={() => void refresh()}>Refresh status</button>}
      {status && !status.available && <p className="git-panel__notice">Git unavailable: {status.error ?? 'not a repository'}</p>}
      {status?.available && (
        <>
          <p className="rightbar__hint">Branch: {status.branch ?? 'detached'} · select files explicitly.</p>
          {status.entries.length === 0 ? <p className="rightbar__hint">Working tree clean.</p> : (
            <ul className="git-panel__files">
              {status.entries.map((entry) => (
                <li key={entry.path}>
                  <label>
                    <input type="checkbox" checked={selected.has(entry.path)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(entry.path)) next.delete(entry.path); else next.add(entry.path); return next; })} />
                    <span>{entry.index}{entry.worktree} {entry.path}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn--small" disabled={selectedPaths.length === 0} onClick={() => void inspectDiff()}>View selected diff</button>
          {diff && <pre className="git-panel__diff">{diff}</pre>}
          <input className="git-panel__message" value={message} placeholder="Commit message (explicit)" onChange={(event) => setMessage(event.target.value)} />
          <button type="button" className="btn btn--small btn--primary" disabled={selectedPaths.length === 0 || message.trim().length === 0} onClick={() => void commit()}>Commit selected</button>
          <button type="button" className="btn btn--small" onClick={() => void refresh()}>Refresh</button>
        </>
      )}
      {notice && <p className="git-panel__notice" role="status">{notice}</p>}
    </section>
  );
}
