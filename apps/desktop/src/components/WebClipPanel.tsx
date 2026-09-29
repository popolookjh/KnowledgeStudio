import { useState } from 'react';
import type { ClipResultDto, RpcResult } from '../../shared/ipc-contract';
import { store, useAppState } from '../state/store';

/**
 * Web clipper (Phase 34). Paste rich content (HTML is read from the
 * clipboard as text — never rendered) or import a saved page. The source URL
 * is stored as provenance metadata and is never fetched.
 */
export function WebClipPanel(): React.JSX.Element {
  const { bridge } = useAppState();
  const [html, setHtml] = useState('');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  const finish = async (result: RpcResult<ClipResultDto> | null): Promise<void> => {
    if (result === null) return;
    if (!result.ok) { setMessage(`Clip failed: ${result.error.message}`); return; }
    setHtml(''); setUrl(''); setTitle('');
    setMessage(`Clipped to ${result.value.path}`);
    await store.refreshEntries();
    await store.openNote(result.value.path);
  };

  return (
    <section className="rightbar__section clip-panel" aria-labelledby="clip-panel-heading">
      <h3 className="rightbar__heading" id="clip-panel-heading">Web clip</h3>
      <p className="rightbar__hint">Offline: pasted or saved content only. Source URLs are recorded, never fetched.</p>
      <form
        className="clip-panel__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!bridge) return;
          void bridge.clipperClip({ html, ...(url.trim() ? { url: url.trim() } : {}), ...(title.trim() ? { title: title.trim() } : {}) }).then(finish);
        }}
      >
        <label>Clip content
          <textarea
            dir="auto"
            rows={4}
            value={html}
            placeholder="Paste a web page selection…"
            onChange={(event) => setHtml(event.target.value)}
            onPaste={(event) => {
              const rich = event.clipboardData.getData('text/html');
              if (rich) { event.preventDefault(); setHtml(rich); }
            }}
          />
        </label>
        <label>Source URL<input dir="ltr" type="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
        <label>Title<input dir="auto" placeholder="optional" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <div className="clip-panel__actions">
          <button type="submit" className="btn btn--small btn--primary" disabled={html.trim().length === 0}>Save clip</button>
          <button type="button" className="btn btn--small" onClick={() => { if (bridge) void bridge.clipperImportFile().then(finish); }}>Import saved page…</button>
        </div>
      </form>
      <p className="rightbar__hint" role="status" aria-live="polite">{message}</p>
    </section>
  );
}
