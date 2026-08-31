import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { store, useAppState } from '../state/store';

/**
 * CodeMirror 6 Markdown editor (ADR-0004).
 *
 * One EditorView per open tab is kept alive in a ref map; tabs render into
 * their own host div so undo history and cursor position survive tab
 * switches naturally. Content changes flow into the store, which drives
 * autosave; Mod-S saves immediately.
 */

function createEditorState(vaultPath: string, initialContent: string): EditorState {
  return EditorState.create({
    doc: initialContent,
    extensions: [
      basicSetup,
      markdown({ base: markdownLanguage }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            void store.saveNote(vaultPath);
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          store.updateContent(vaultPath, update.state.doc.toString());
        }
      }),
    ],
  });
}

export function EditorPane(): React.JSX.Element {
  const { tabs, activePath, conflictPath } = useAppState();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewsRef = useRef(new Map<string, EditorView>());

  // Create a view for each open tab once.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    for (const tab of tabs) {
      if (!viewsRef.current.has(tab.path)) {
        const view = new EditorView({
          state: createEditorState(tab.path, tab.content),
          parent: container,
        });
        view.dom.style.display = 'none';
        viewsRef.current.set(tab.path, view);
      }
    }
    // Tabs closing is handled in the effect below; this effect only adds.
  }, [tabs]);

  // Remove views for closed tabs.
  useEffect(() => {
    const openPaths = new Set(tabs.map((tab) => tab.path));
    for (const [path, view] of viewsRef.current) {
      if (!openPaths.has(path)) {
        view.destroy();
        viewsRef.current.delete(path);
      }
    }
  }, [tabs]);

  // Show only the active view; sync external reloads (conflict resolution,
  // watcher-triggered reload) into the visible document.
  useEffect(() => {
    for (const [path, view] of viewsRef.current) {
      const visible = path === activePath;
      view.dom.style.display = visible ? '' : 'none';
      if (!visible) {
        continue;
      }
      const tab = tabs.find((entry) => entry.path === path);
      if (!tab) {
        continue;
      }
      const current = view.state.doc.toString();
      if (current !== tab.content) {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: tab.content },
        });
      }
    }
  }, [activePath, tabs, conflictPath]);

  // Cleanup on unmount.
  useEffect(() => {
    const views = viewsRef.current;
    return () => {
      for (const view of views.values()) {
        view.destroy();
      }
      views.clear();
    };
  }, []);

  if (tabs.length === 0 || !activePath) {
    return (
      <div className="editor editor--empty">
        <p>Select a note from the vault, or create a new one.</p>
      </div>
    );
  }
  return <div className="editor editor__hosts" ref={containerRef} />;
}
