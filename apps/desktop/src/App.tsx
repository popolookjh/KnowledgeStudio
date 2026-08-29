/**
 * Phase 0 application shell.
 *
 * Deliberately minimal: a real Electron window rendering a real React
 * application through the sandboxed preload bridge. Feature surfaces
 * (explorer, editor, sidebars) arrive with their own phases.
 */
export default function App() {
  const bridge = window.knowledgeStudio;
  const version = bridge?.version ?? 'dev';
  const platform = bridge?.platform ?? 'unknown';

  return (
    <div className="app-shell">
      <header className="app-shell__titlebar">
        <span className="app-shell__brand">Knowledge Studio</span>
        <span className="app-shell__titlebar-meta">Foundation · Phase 0</span>
      </header>
      <main className="app-shell__main">
        <section className="app-shell__hero">
          <h1>Your knowledge, in plain Markdown.</h1>
          <p>
            Knowledge Studio is a local-first, offline-first knowledge workspace. Your notes stay
            in ordinary Markdown files that remain fully usable — with or without this
            application.
          </p>
        </section>
        <section className="app-shell__meta">
          <span>v{version}</span>
          <span aria-hidden="true">·</span>
          <span>{platform}</span>
        </section>
      </main>
      <footer className="app-shell__statusbar">
        <span>Ready</span>
      </footer>
    </div>
  );
}
