import { useMemo } from 'react';
import { extractOutline, readFrontmatter } from '@knowledge-studio/markdown';
import { useAppState } from '../state/store';

/**
 * Right sidebar: note properties (frontmatter) and heading outline.
 * Properties are read-only in this phase; the editing panel lands with the
 * metadata phase.
 */

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyScalar(item)).join(', ');
  }
  return stringifyScalar(value);
}

function stringifyScalar(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function RightSidebar(): React.JSX.Element {
  const { tabs, activePath } = useAppState();
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;

  const { properties, outline } = useMemo(() => {
    if (!activeTab) {
      return { properties: [] as readonly (readonly [string, unknown])[], outline: [] };
    }
    const parsed = readFrontmatter(activeTab.content);
    return {
      properties: Object.entries(parsed.data),
      outline: extractOutline(parsed.body),
    };
  }, [activeTab]);

  return (
    <aside className="rightbar">
      <section className="rightbar__section">
        <h3 className="rightbar__heading">Properties</h3>
        {properties.length === 0 ? (
          <p className="rightbar__hint">No YAML frontmatter properties.</p>
        ) : (
          <dl className="rightbar__props">
            {properties.map(([key, value]) => (
              <div key={key} className="rightbar__prop">
                <dt>{key}</dt>
                <dd title={formatValue(value)}>{formatValue(value) || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="rightbar__section">
        <h3 className="rightbar__heading">Outline</h3>
        {outline.length === 0 ? (
          <p className="rightbar__hint">No headings in this note.</p>
        ) : (
          <ul className="rightbar__outline">
            {outline.map((entry) => (
              <li
                key={`${entry.line}:${entry.slug}`}
                className={`rightbar__outline-item level-${entry.level}`}
                title={`Line ${entry.line}`}
              >
                {entry.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
