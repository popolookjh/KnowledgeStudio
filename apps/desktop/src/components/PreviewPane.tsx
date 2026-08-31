import { useMemo } from 'react';
import { renderMarkdownToHtml } from '@knowledge-studio/markdown';
import { useAppState } from '../state/store';

/**
 * Sanitized rendered preview of the active note (body only; frontmatter is
 * shown in the properties panel). Output comes from the strict
 * rehype-sanitize pipeline — no raw HTML, scripts, or javascript: URLs.
 */
export function PreviewPane(): React.JSX.Element {
  const { tabs, activePath } = useAppState();
  const activeTab = tabs.find((tab) => tab.path === activePath) ?? null;

  const html = useMemo(() => {
    if (!activeTab) {
      return '';
    }
    const bodyStart = activeTab.content.startsWith('---\n')
      ? activeTab.content.indexOf('\n---', 4)
      : -1;
    const body =
      bodyStart === -1 ? activeTab.content : activeTab.content.slice(bodyStart + 5);
    return renderMarkdownToHtml(body);
  }, [activeTab]);

  if (!activeTab) {
    return <div className="preview preview--empty" />;
  }
  return <div className="preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
