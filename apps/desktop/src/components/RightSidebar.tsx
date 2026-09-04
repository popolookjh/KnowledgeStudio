import { useMemo } from 'react';
import { extractOutline, readFrontmatter } from '@knowledge-studio/markdown';
import { useAppState } from '../state/store';
import { GitPanel } from './GitPanel';
import { HistoryPanel } from './HistoryPanel';
import { LinksPanel } from './LinksPanel';
import { PluginPanel } from './PluginPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { TagBrowser } from './TagBrowser';

/**
 * Right sidebar: editable properties, heading outline, and links.
 */

export function RightSidebar(): React.JSX.Element {
  const { tabs, activePath } = useAppState();
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;

  const outline = useMemo(() => {
    if (!activeTab) {
      return [];
    }
    return extractOutline(readFrontmatter(activeTab.content).body);
  }, [activeTab]);

  return (
    <aside className="rightbar">
      <PropertiesPanel />
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
      <LinksPanel />
      <HistoryPanel />
      <GitPanel />
      <PluginPanel />
      <TagBrowser />
    </aside>
  );
}
