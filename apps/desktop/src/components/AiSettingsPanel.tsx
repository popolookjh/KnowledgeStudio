import { useCallback, useEffect, useState } from 'react';
import type { AiConfigStatusDto, AiProviderConfigDto } from '../../shared/ipc-contract';
import { useAppState } from '../state/store';

const DEFAULT_FORM: Omit<AiProviderConfigDto, 'hasSecret'> = {
  id: '', displayName: '', kind: 'local', enabled: false, semanticSearchEnabled: false, sendsVaultContent: false, disclosureConfirmed: false,
};

/** Provider-neutral, opt-in AI settings. Opening this panel performs no network request. */
export function AiSettingsPanel(): React.JSX.Element {
  const { bridge } = useAppState();
  const [status, setStatus] = useState<AiConfigStatusDto | null>(null);
  const [form, setForm] = useState<Omit<AiProviderConfigDto, 'hasSecret'>>(DEFAULT_FORM);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.aiConfigList();
    if (result.ok) {
      setStatus(result.value);
      setNotice(null);
    } else setNotice(result.error.message);
  }, [bridge]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.aiConfigUpsert(form);
    if (result.ok) {
      setNotice(`Saved ${result.value.displayName}; provider remains ${result.value.enabled ? 'enabled by configuration' : 'disabled'}.`);
      setForm(DEFAULT_FORM);
      await refresh();
    } else setNotice(result.error.message);
  };

  return (
    <section className="rightbar__section ai-panel">
      <h3 className="rightbar__heading">AI providers</h3>
      <p className="rightbar__hint">Provider-neutral and offline by default. Opening this panel never contacts a provider.</p>
      <p className="rightbar__hint">Secure storage: {status?.secureStorageAvailable ? 'available (OS-backed)' : 'unavailable — secrets cannot be saved'}</p>
      {status?.providers.map((provider) => (
        <article key={provider.id} className="ai-panel__entry">
          <strong>{provider.displayName}</strong>
          <p>{provider.kind} · {provider.model ?? 'no model'} · {provider.enabled ? 'enabled' : 'disabled'}</p>
          <p>{provider.kind === 'external' ? `Endpoint: ${provider.endpoint ?? 'missing'}` : 'Local provider'}</p>
          <p>Vault content transmission: {provider.sendsVaultContent ? (provider.disclosureConfirmed ? 'explicitly disclosed' : 'blocked pending disclosure') : 'off'}</p>
          <p>Semantic search: {provider.semanticSearchEnabled ? 'configured' : 'off'} · Secret: {provider.hasSecret ? 'stored securely' : 'not configured'}</p>
        </article>
      ))}
      <details className="ai-panel__form">
        <summary>Add or update provider metadata</summary>
        <input value={form.id} placeholder="provider.id" onChange={(event) => setForm({ ...form, id: event.target.value })} />
        <input value={form.displayName} placeholder="Display name" onChange={(event) => setForm({ ...form, displayName: event.target.value })} />
        <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as 'local' | 'external', endpoint: undefined })}>
          <option value="local">Local</option><option value="external">External</option>
        </select>
        {form.kind === 'external' && <input value={form.endpoint ?? ''} placeholder="https://provider.example" onChange={(event) => setForm({ ...form, endpoint: event.target.value })} />}
        <input value={form.model ?? ''} placeholder="Model (optional)" onChange={(event) => setForm({ ...form, model: event.target.value || undefined })} />
        <label><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Enable configuration</label>
        <label><input type="checkbox" checked={form.semanticSearchEnabled} onChange={(event) => setForm({ ...form, semanticSearchEnabled: event.target.checked })} /> Enable semantic search when a provider is explicitly activated</label>
        <label><input type="checkbox" checked={form.sendsVaultContent} onChange={(event) => setForm({ ...form, sendsVaultContent: event.target.checked })} /> This provider may receive vault content</label>
        {form.sendsVaultContent && <label className="ai-panel__disclosure"><input type="checkbox" checked={form.disclosureConfirmed} onChange={(event) => setForm({ ...form, disclosureConfirmed: event.target.checked })} /> I confirm the external content disclosure</label>}
        <p className="rightbar__hint">Secret entry is intentionally unavailable in renderer UI; plaintext secrets are never stored in renderer state.</p>
        <button type="button" className="btn btn--small btn--primary" onClick={() => void save()}>Save provider metadata</button>
      </details>
      <button type="button" className="btn btn--small" onClick={() => void refresh()}>Refresh</button>
      {notice && <p className="ai-panel__notice" role="status">{notice}</p>}
    </section>
  );
}
