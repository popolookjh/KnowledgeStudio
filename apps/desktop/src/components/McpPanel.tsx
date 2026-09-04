import { useCallback, useEffect, useState } from 'react';
import type { McpStatusDto } from '../../shared/ipc-contract';
import { useAppState } from '../state/store';

/** Loopback-only, read-only MCP lifecycle surface. */
export function McpPanel(): React.JSX.Element {
  const { bridge, sessionRoot } = useAppState();
  const [status, setStatus] = useState<McpStatusDto | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.mcpStatus();
    if (result.ok) {
      setStatus(result.value);
      setNotice(null);
    } else setNotice(result.error.message);
  }, [bridge]);

  useEffect(() => { void refresh(); }, [refresh, sessionRoot]);

  const start = async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.mcpStart();
    if (result.ok) setStatus(result.value);
    else setNotice(result.error.message);
  };
  const stop = async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.mcpStop();
    if (result.ok) setStatus(result.value);
    else setNotice(result.error.message);
  };

  return (
    <section className="rightbar__section mcp-panel">
      <h3 className="rightbar__heading">MCP (local)</h3>
      <p className="rightbar__hint">Loopback-only · read-only · no shell, process, or write tools.</p>
      {!sessionRoot && <p className="rightbar__hint">Open a vault before starting MCP.</p>}
      {status && (
        <>
          <p>Status: {status.running ? 'running' : 'stopped'}</p>
          <p>Bind: {status.endpoint ?? 'not listening'}</p>
          <p>Mode: {status.readOnly ? 'read-only' : 'restricted'}</p>
          <p>Tools: {status.tools.join(', ')}</p>
        </>
      )}
      <button type="button" className="btn btn--small btn--primary" disabled={!sessionRoot || status?.running === true} onClick={() => void start()}>Start local MCP</button>
      <button type="button" className="btn btn--small" disabled={!status?.running} onClick={() => void stop()}>Stop MCP</button>
      <button type="button" className="btn btn--small" onClick={() => void refresh()}>Refresh</button>
      {(notice ?? status?.lastError) && <p className="mcp-panel__notice" role="status">{notice ?? status?.lastError}</p>}
    </section>
  );
}
