# Architecture

Knowledge Studio is a modular Electron desktop application for working with a local vault
of Markdown notes. This document describes the stable architectural skeleton; detailed
decisions live in [docs/adr/](docs/adr/).

## Core principle: content ≠ index ≠ application state

| Layer | What it holds | Source of truth | Recoverable? |
| ----- | ------------- | --------------- | ------------ |
| **Content** | Markdown notes, canvas JSON, attachments | The files themselves | The vault is the product |
| **Index** | SQLite: search (FTS5), backlinks, graph, metadata cache, embedding refs | Derived from content | Always — `REBUILD INDEX` recreates it |
| **Application state** | Settings, layout, open tabs, recents | JSON in app-data dir | Regenerable; never mixed into notes |

Rules that follow from this separation:

1. Markdown never depends on the index. The app must stay usable while the index is
   stale, missing, or rebuilding.
2. The index is disposable. Corruption is handled by discard-and-rebuild, never by
   touching content.
3. Workspace state is never written into note files, and note metadata never leaks into
   workspace state.

## Layering

```
┌───────────────────────────────────────────────────────────────┐
│ apps/desktop                                                  │
│   Electron main (Node, privileged)  ← IPC contracts →  React  │
│   sandboxed preload bridge                          renderer  │
└──────────────┬────────────────────────────────────────────────┘
               │ invokes domain packages directly (main process)
┌──────────────▼────────────────────────────────────────────────┐
│ Domain packages (pure TypeScript, no Electron imports)        │
│   vault · markdown · metadata · search · graph · indexer      │
│   commands · templates · history · git-integration            │
│   security · settings · plugin-sdk · mcp · ai-bridge          │
├───────────────────────────────────────────────────────────────┤
│ packages/shared: Result, error codes, vault path algebra, IDs │
└───────────────────────────────────────────────────────────────┘
```

- **Domain packages** never import Electron or React. They are plain TypeScript libraries
  with their own tests, runnable in Node and therefore testable without a GUI.
- **The renderer** is a view layer. It receives data over typed IPC and owns no vault
  logic. Filesystem paths never cross into the renderer; vault-relative paths do.
- **The main process** composes domain packages and enforces security boundaries
  (vault containment, plugin permissions, MCP exposure).

## Vault model

- The user selects a **vault root** — an ordinary folder of Markdown files.
- All operations address notes by **vault-relative POSIX-style paths**
  (`notes/idea.md`), validated by the path algebra in `packages/shared`
  (traversal, drive letters, UNC, reserved names, and Windows-hostile characters
  are rejected before any filesystem call).
- Writes are atomic (temp file + rename), destructive moves go to an
  application trash first, and the vault is watched for external edits.

## Index model

- SQLite with FTS5 is the only machine-facing index. It stores no unique data:
  dropping the database file and running `REBUILD INDEX` fully restores it.
- Indexers are incremental (driven by vault watch events) and idempotent.
- Performance targets and benchmark fixtures land with the search phase.

## Security posture (summary)

- Renderer: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, strict
  CSP. No remote content; Markdown preview is sanitized; external links are explicit.
- Plugins declare permissions in a manifest; untrusted plugins never run automatically.
- MCP server is local-only (loopback), read-only by default, opt-in.
- No telemetry, no cloud sync, no hidden network requests — ever, by default.

See [SECURITY.md](SECURITY.md) and [docs/security/](docs/security/) for the threat model.

## Testing strategy

| Level | Scope | Tooling |
| ----- | ----- | ------- |
| Unit | Domain packages, path algebra, parsers | Vitest |
| Integration | vault + index + search + backlinks on temp fixtures | Vitest |
| Security | traversal, XSS/sanitization, plugin/MCP boundaries | Vitest |
| UI | React components | Vitest + Testing Library |
| E2E | app boot → create vault → edit → search → restart | Playwright |

Bugs are fixed together with a regression test; disabled tests are treated as failures.
