import { useCallback, useEffect, useState } from 'react';
import type { PluginDto } from '../../shared/ipc-contract';
import { useAppState } from '../state/store';

/** Manifest/policy UI only. Runtime plugin loading remains explicitly deferred. */
export function PluginPanel(): React.JSX.Element {
  const { bridge } = useAppState();
  const [plugins, setPlugins] = useState<readonly PluginDto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.listPlugins();
    if (result.ok) {
      setPlugins(result.value);
      setNotice(null);
    } else setNotice(result.error.message);
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = async (plugin: PluginDto, enabled: boolean): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.setPluginEnabled(plugin.id, enabled);
    if (result.ok) setPlugins(result.value);
    else setNotice(result.error.message);
  };

  const approve = async (
    plugin: PluginDto,
    permission: 'PROCESS_EXECUTE' | 'SECRETS',
    approved: boolean,
  ): Promise<void> => {
    if (!bridge) return;
    const result = await bridge.approvePluginHighRisk(plugin.id, permission, approved);
    if (result.ok) setPlugins(result.value);
    else setNotice(result.error.message);
  };

  return (
    <section className="rightbar__section plugin-panel">
      <h3 className="rightbar__heading">Plugins</h3>
      <p className="rightbar__hint">Local manifests only. Plugin runtime loading is deferred.</p>
      <button type="button" className="btn btn--small" onClick={() => void refresh()}>
        Refresh local manifests
      </button>
      {plugins.length === 0 && (
        <p className="rightbar__hint">No local plugin manifests discovered.</p>
      )}
      {plugins.map((plugin) => (
        <article key={plugin.id} className="plugin-panel__entry">
          <strong>
            {plugin.name} <small>v{plugin.version}</small>
          </strong>
          <p>{plugin.description || plugin.id}</p>
          <p>
            Requested:{' '}
            {plugin.requestedPermissions.length ? plugin.requestedPermissions.join(', ') : 'none'}
          </p>
          <p>
            Status:{' '}
            {plugin.enabled
              ? 'enabled by policy (runtime deferred)'
              : (plugin.reason ?? 'disabled')}
          </p>
          <label>
            <input
              type="checkbox"
              checked={plugin.enabled}
              onChange={(event) => void setEnabled(plugin, event.target.checked)}
            />{' '}
            Enable policy
          </label>
          {(['PROCESS_EXECUTE', 'SECRETS'] as const)
            .filter((permission) => plugin.requestedPermissions.includes(permission))
            .map((permission) => (
              <label key={permission} className="plugin-panel__sensitive">
                <input
                  type="checkbox"
                  checked={plugin.approvedHighRisk.includes(permission)}
                  onChange={(event) => void approve(plugin, permission, event.target.checked)}
                />{' '}
                Explicitly approve {permission}
              </label>
            ))}
        </article>
      ))}
      {notice && (
        <p className="plugin-panel__notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
