import { useState } from 'react';
import { readMetadata } from '@knowledge-studio/metadata';
import { store, useAppState } from '../state/store';

/**
 * Editable properties panel (Phase 4). Scalar and list fields edit inline
 * (lists as comma-separated text, `confidence` parsed as a number);
 * structured values render read-only. Unknown properties stay fully
 * preserved through the metadata package's round trip.
 */

const LIST_KEYS = new Set(['tags', 'aliases']);

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => formatValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function PropertiesPanel(): React.JSX.Element {
  const { tabs, activePath } = useAppState();
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [newKey, setNewKey] = useState('');
  const [addedKeys, setAddedKeys] = useState<string[]>([]);

  if (!activeTab) {
    return (
      <section className="rightbar__section">
        <h3 className="rightbar__heading">Properties</h3>
        <p className="rightbar__hint">Open a note to edit its properties.</p>
      </section>
    );
  }

  const { data, issues } = readMetadata(activeTab.content);
  const rows: readonly (readonly [string, unknown])[] = [
    ...Object.entries(data),
    ...addedKeys
      .filter((key) => !(key in data))
      .map((key) => [key, undefined] as const),
  ];

  const startEdit = (key: string, current: unknown): void => {
    setDraft(formatValue(current));
    setEditingKey(key);
  };

  const commit = (key: string, raw: string): void => {
    setEditingKey(null);
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      setAddedKeys((keys) => keys.filter((candidate) => candidate !== key));
      if (key in data) {
        void store.setMetadataProperty(activeTab.path, key, null);
      }
      return;
    }
    void store.setMetadataProperty(activeTab.path, key, trimmed);
  };

  return (
    <section className="rightbar__section">
      <h3 className="rightbar__heading">Properties</h3>
      {issues.length > 0 && (
        <p className="rightbar__props-issue" role="alert">
          {issues.map((issue) => issue.message).join('; ')}
        </p>
      )}
      {rows.length === 0 && (
        <p className="rightbar__hint">No YAML frontmatter properties yet.</p>
      )}
      <dl className="rightbar__props">
        {rows.map(([key, value]) => {
          const editable = value === undefined || typeof value !== 'object' || Array.isArray(value);
          const isEditing = editingKey === key;
          return (
            <div key={key} className="rightbar__prop">
              <dt>{key}</dt>
              <dd>
                {editable && isEditing ? (
                  <input
                    className="rightbar__prop-input"
                    autoFocus
                    value={draft}
                    placeholder={LIST_KEYS.has(key) ? 'a, b, c' : 'value'}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(key, draft)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commit(key, draft);
                      }
                      if (event.key === 'Escape') {
                        setEditingKey(null);
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="rightbar__prop-value"
                    title={editable ? 'Click to edit; empty removes' : formatValue(value)}
                    disabled={!editable}
                    onClick={() => startEdit(key, value)}
                  >
                    {formatValue(value) || '—'}
                  </button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <form
        className="rightbar__prop-new"
        onSubmit={(event) => {
          event.preventDefault();
          const key = newKey.trim();
          if (key.length > 0 && !rows.some(([existing]) => existing === key)) {
            setAddedKeys((keys) => [...keys, key]);
            startEdit(key, undefined);
          }
          setNewKey('');
        }}
      >
        <input
          className="rightbar__prop-input"
          placeholder="Add property…"
          value={newKey}
          onChange={(event) => setNewKey(event.target.value)}
        />
      </form>
    </section>
  );
}
