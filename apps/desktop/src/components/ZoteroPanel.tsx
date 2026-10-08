import { useState } from 'react';
import type { RpcResult, ZoteroImportResultDto } from '../../shared/ipc-contract';
import { store, useAppState } from '../state/store';

const DEFAULT_PORT = 23119;

/**
 * Zotero (Phase 37): import a CSL JSON/BibTeX export, or sync from the
 * Zotero 7 desktop local API on 127.0.0.1. No Zotero account or API key is
 * used; re-imports update existing literature notes instead of duplicating.
 */
export function ZoteroPanel(): React.JSX.Element {
  const { bridge, sessionRoot } = useAppState();
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = async (result: RpcResult<ZoteroImportResultDto> | null): Promise<void> => {
    setBusy(false);
    if (result === null) return;
    if (!result.ok) { setMessage(`Zotero: ${result.error.message}`); return; }
    const { created, updated, unchanged, failed } = result.value;
    setMessage(`Zotero: ${created} created, ${updated} updated, ${unchanged} unchanged${failed ? `, ${failed} failed` : ''}`);
    await store.refreshEntries();
    const first = result.value.paths[0];
    if (first) await store.openNote(first);
  };

  return (
    <section className="rightbar__section zotero-panel" aria-labelledby="zotero-panel-heading">
      <h3 className="rightbar__heading" id="zotero-panel-heading">Zotero</h3>
      <p className="rightbar__hint">Local only: exports or the Zotero desktop API on 127.0.0.1. No account keys.</p>
      <button type="button" className="btn btn--small" disabled={!sessionRoot || busy} onClick={() => { if (bridge) { setBusy(true); void bridge.zoteroImportFile().then(finish); } }}>Import Zotero export…</button>
      <div className="zotero-panel__row">
        <label>Local API port <input inputMode="numeric" dir="ltr" value={port} onChange={(event) => setPort(event.target.value.replace(/\D/g, '').slice(0, 5))} /></label>
        <button type="button" className="btn btn--small" disabled={!sessionRoot || busy} onClick={() => { if (bridge) { setBusy(true); void bridge.zoteroSyncLocal(Number(port)).then(finish); } }}>Sync from Zotero</button>
      </div>
      <p className="rightbar__hint" role="status" aria-live="polite">{message}</p>
    </section>
  );
}
