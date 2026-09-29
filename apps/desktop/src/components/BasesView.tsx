import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectDirection } from '@knowledge-studio/rtl';
import type { BaseDefinitionDto, BaseQueryDto, BaseRowDto, BaseSummaryDto } from '../../shared/ipc-contract';
import { store } from '../state/store';

/**
 * Bases: Table, Card, and keyboard-accessible Kanban views over note
 * metadata. All data comes from the trusted main-process Base host; edits go
 * back through `basesSetField`, never through direct file access.
 */

const PAGE_SIZE = 200;
const UNASSIGNED = 'Unassigned';
type CellValue = BaseRowDto['values'][string];
type EditValue = string | number | boolean | null;

function display(value: CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  return Array.isArray(value) ? value.join(', ') : String(value);
}

/** Keeps the original scalar type when the user's draft still fits it. */
function coerce(draft: string, original: CellValue | undefined): EditValue {
  const trimmed = draft.trim();
  if (trimmed.length === 0) return null;
  if (typeof original === 'number' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  if (typeof original === 'boolean' && (trimmed === 'true' || trimmed === 'false')) return trimmed === 'true';
  return trimmed;
}

function EditableCell({ row, field, onCommit }: { readonly row: BaseRowDto; readonly field: string; readonly onCommit: (row: BaseRowDto, field: string, value: EditValue) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const value = row.values[field];
  const readOnly = field === 'title' || field === 'path' || field === 'modified' || field === 'id';
  if (editing) {
    return (
      <input
        className="bases__cell-input"
        dir="auto"
        autoFocus
        aria-label={`Edit ${field} for ${row.title}`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { setEditing(false); onCommit(row, field, coerce(draft, value)); }
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="bases__cell"
      dir="auto"
      disabled={readOnly}
      aria-label={`${field}: ${display(value) || 'empty'}${readOnly ? '' : '. Press Enter to edit'}`}
      onClick={() => { setDraft(display(value)); setEditing(true); }}
    >
      {display(value) || '—'}
    </button>
  );
}

function BaseTable({ query, limit, onCommit }: { readonly query: BaseQueryDto; readonly limit: number; readonly onCommit: (row: BaseRowDto, field: string, value: EditValue) => void }): React.JSX.Element {
  const { definition } = query.base;
  return (
    <table className="bases__table" aria-rowcount={query.total + 1}>
      <caption className="bases__caption">{definition.name} — {query.total} rows</caption>
      <thead>
        <tr>
          <th scope="col">Note</th>
          {definition.fields.map((field) => <th key={field} scope="col" dir="auto">{field}</th>)}
        </tr>
      </thead>
      <tbody>
        {query.rows.slice(0, limit).map((row, index) => (
          <tr key={row.path} aria-rowindex={index + 2}>
            <th scope="row">
              <button type="button" className="bases__open" dir="auto" onClick={() => { void store.openNote(row.path); store.closeBases(); }}>{row.title}</button>
            </th>
            {definition.fields.map((field) => <td key={field}><EditableCell row={row} field={field} onCommit={onCommit} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BaseCards({ query, limit }: { readonly query: BaseQueryDto; readonly limit: number }): React.JSX.Element {
  const { definition } = query.base;
  return (
    <ul className="bases__cards" aria-label={`${definition.name} cards`}>
      {query.rows.slice(0, limit).map((row) => (
        <li key={row.path}>
          <article className="bases__card" aria-label={row.title}>
            <h4 dir="auto"><button type="button" className="bases__open" onClick={() => { void store.openNote(row.path); store.closeBases(); }}>{row.title}</button></h4>
            <dl>
              {definition.fields.map((field) => (
                <div key={field} className="bases__card-field"><dt dir="auto">{field}</dt><dd dir="auto">{display(row.values[field]) || '—'}</dd></div>
              ))}
            </dl>
          </article>
        </li>
      ))}
    </ul>
  );
}

function BaseKanban({ query, direction, onMove }: { readonly query: BaseQueryDto; readonly direction: 'ltr' | 'rtl'; readonly onMove: (row: BaseRowDto, group: string) => void }): React.JSX.Element {
  const groupBy = query.base.definition.groupBy ?? '';
  const groups = useMemo(() => {
    const map = new Map<string, BaseRowDto[]>();
    for (const row of query.rows) {
      const key = display(row.values[groupBy]) || UNASSIGNED;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    if (!map.has(UNASSIGNED)) map.set(UNASSIGNED, []);
    const collator = new Intl.Collator(undefined, { numeric: true });
    return [...map.entries()].sort(([a], [b]) => (a === UNASSIGNED ? 1 : b === UNASSIGNED ? -1 : collator.compare(a, b)));
  }, [query.rows, groupBy]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLLIElement>, row: BaseRowDto, groupIndex: number): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const forward = event.key === 'ArrowRight' ? 1 : -1;
      const target = groups[groupIndex + (direction === 'rtl' ? -forward : forward)];
      if (target) onMove(row, target[0]);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const sibling = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement) sibling.focus();
    } else if (event.key === 'Enter') {
      void store.openNote(row.path);
      store.closeBases();
    }
  };

  return (
    <div className="bases__kanban" aria-describedby="bases-kanban-help">
      <p id="bases-kanban-help" className="bases__hint">Focus a card, then use Left/Right arrows to move it between columns, Up/Down to move between cards, and Enter to open the note.</p>
      <div className="bases__columns">
        {groups.map(([group, rows], groupIndex) => (
          <section key={group} className="bases__column" aria-labelledby={`bases-col-${groupIndex}`}>
            <h4 id={`bases-col-${groupIndex}`} dir="auto">{group} <span className="bases__count">({rows.length})</span></h4>
            <ul aria-label={`${group} cards`}>
              {rows.slice(0, PAGE_SIZE).map((row) => (
                <li
                  key={row.path}
                  className="bases__kanban-card"
                  tabIndex={0}
                  dir="auto"
                  data-card-path={row.path}
                  aria-label={`${row.title}, ${groupBy}: ${group}`}
                  onKeyDown={(event) => onKeyDown(event, row, groupIndex)}
                >
                  {row.title}
                </li>
              ))}
            </ul>
            {rows.length > PAGE_SIZE && <p className="bases__hint">+{rows.length - PAGE_SIZE} more in this column</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

function CreateBaseForm({ onCreate }: { readonly onCreate: (definition: BaseDefinitionDto) => void }): React.JSX.Element {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [fields, setFields] = useState('status');
  const [groupBy, setGroupBy] = useState('');
  return (
    <form
      className="bases__create"
      aria-label="Create base"
      onSubmit={(event) => {
        event.preventDefault();
        const fieldList = fields.split(',').map((field) => field.trim()).filter((field) => field.length > 0);
        onCreate({
          schemaVersion: 1,
          id: `base-${Date.now().toString(36)}`,
          name: name.trim(),
          view: 'table',
          ...(folder.trim() ? { folder: folder.trim().replace(/\/+$/, '') } : {}),
          ...(tag.trim() ? { tags: [tag.trim().replace(/^#/, '')] } : {}),
          filters: [],
          fields: [...new Set(fieldList)],
          ...(groupBy.trim() ? { groupBy: groupBy.trim() } : {}),
        });
        setName('');
      }}
    >
      <label>Name<input required dir="auto" value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Folder<input dir="auto" placeholder="optional" value={folder} onChange={(event) => setFolder(event.target.value)} /></label>
      <label>Tag<input dir="auto" placeholder="optional" value={tag} onChange={(event) => setTag(event.target.value)} /></label>
      <label>Fields<input dir="auto" value={fields} onChange={(event) => setFields(event.target.value)} /></label>
      <label>Group by<input dir="auto" placeholder="optional" value={groupBy} onChange={(event) => setGroupBy(event.target.value)} /></label>
      <button type="submit" className="btn btn--small btn--primary">Create base</button>
    </form>
  );
}

export function BasesView(): React.JSX.Element {
  const api = window.knowledgeStudio ?? null;
  const [bases, setBases] = useState<readonly BaseSummaryDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState<BaseQueryDto | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const focusPath = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refreshList = useCallback(async (): Promise<void> => {
    if (!api) return;
    const listed = await api.basesList();
    if (listed.ok) setBases(listed.value);
    else setAnnouncement(listed.error.message);
  }, [api]);

  const load = useCallback(async (id: string): Promise<void> => {
    if (!api) return;
    const result = await api.basesQuery(id);
    if (result.ok) { setQuery(result.value); setActiveId(id); }
    else setAnnouncement(`Base failed to load: ${result.error.message}`);
  }, [api]);

  useEffect(() => { void refreshList(); }, [refreshList]);

  useEffect(() => {
    if (!focusPath.current || !rootRef.current) return;
    const card = rootRef.current.querySelector<HTMLElement>(`[data-card-path="${CSS.escape(focusPath.current)}"]`);
    card?.focus();
    focusPath.current = null;
  }, [query]);

  const commit = useCallback(async (row: BaseRowDto, field: string, value: EditValue): Promise<boolean> => {
    if (!api || !activeId) return false;
    const result = await api.basesSetField({ path: row.path, key: field, value, expectedMtimeMs: row.mtimeMs });
    if (!result.ok) {
      setAnnouncement(result.error.code === 'VAULT_MODIFIED_SINCE_READ' ? `${row.title} changed on disk; reloaded the base` : `Edit failed: ${result.error.message}`);
      await load(activeId);
      return false;
    }
    await load(activeId);
    return true;
  }, [api, activeId, load]);

  const saveDefinition = async (definition: BaseDefinitionDto, revision?: number): Promise<void> => {
    if (!api) return;
    const saved = await api.basesSave(definition, revision);
    if (!saved.ok) { setAnnouncement(`Base save failed: ${saved.error.message}`); return; }
    await refreshList();
    await load(saved.value.definition.id);
    setAnnouncement(`Saved base ${saved.value.definition.name}`);
  };

  const definition = query?.base.definition ?? null;
  const direction = definition && detectDirection(definition.name) === 'rtl' ? 'rtl' : 'ltr';

  return (
    <div className="bases" ref={rootRef} dir={direction}>
      <nav className="bases__sidebar" aria-label="Bases list">
        <ul>
          {bases.map((base) => (
            <li key={base.id}>
              <button type="button" dir="auto" className={`bases__base${base.id === activeId ? ' is-active' : ''}`} aria-current={base.id === activeId ? 'true' : undefined} onClick={() => { setLimit(PAGE_SIZE); setConfirmDelete(false); void load(base.id); }}>{base.name}</button>
            </li>
          ))}
        </ul>
        <CreateBaseForm onCreate={(created) => { void saveDefinition(created); }} />
      </nav>
      <section className="bases__main" aria-label="Base view">
        {query && definition ? (
          <>
            <div className="bases__toolbar">
              <div role="tablist" aria-label="Base view type">
                {(['table', 'card', 'kanban'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={definition.view === view}
                    disabled={view === 'kanban' && !definition.groupBy}
                    className={`btn btn--small${definition.view === view ? ' is-active' : ''}`}
                    onClick={() => { void saveDefinition({ ...definition, view }, query.base.revision); }}
                  >
                    {view === 'table' ? 'Table' : view === 'card' ? 'Cards' : 'Kanban'}
                  </button>
                ))}
              </div>
              <span className="bases__meta">{query.total} notes · {query.elapsedMs} ms</span>
              {confirmDelete ? (
                <>
                  <button type="button" className="btn btn--small" onClick={() => {
                    void (async () => {
                      if (!api) return;
                      const removed = await api.basesDelete(definition.id, query.base.revision);
                      setConfirmDelete(false);
                      if (!removed.ok) { setAnnouncement(removed.error.message); return; }
                      setQuery(null); setActiveId(null); await refreshList();
                      setAnnouncement('Base definition deleted; notes were not changed');
                    })();
                  }}>Confirm delete</button>
                  <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </>
              ) : <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(true)}>Delete base…</button>}
            </div>
            <div className="bases__content" role="tabpanel">
              {definition.view === 'table' && <BaseTable query={query} limit={limit} onCommit={(row, field, value) => { void commit(row, field, value).then((ok) => { if (ok) setAnnouncement(`Updated ${field} for ${row.title}`); }); }} />}
              {definition.view === 'card' && <BaseCards query={query} limit={limit} />}
              {definition.view === 'kanban' && (
                <BaseKanban
                  query={query}
                  direction={direction}
                  onMove={(row, group) => {
                    focusPath.current = row.path;
                    void commit(row, definition.groupBy ?? '', group === UNASSIGNED ? null : group).then((ok) => { if (ok) setAnnouncement(`Moved ${row.title} to ${group}`); });
                  }}
                />
              )}
              {definition.view !== 'kanban' && query.rows.length > limit && (
                <button type="button" className="btn btn--small" onClick={() => setLimit((current) => current + PAGE_SIZE)}>Show more ({query.rows.length - limit} remaining)</button>
              )}
            </div>
          </>
        ) : (
          <p className="bases__hint">{bases.length === 0 ? 'Create a base to view note metadata as a table, cards, or a Kanban board.' : 'Choose a base.'}</p>
        )}
        <p className="bases__live" role="status" aria-live="polite">{announcement}</p>
      </section>
    </div>
  );
}
