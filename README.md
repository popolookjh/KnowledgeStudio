# Knowledge Studio

A local-first, offline-first desktop knowledge workspace built on **plain Markdown files**.
Notes, wiki links, backlinks, graph, search, properties, templates, canvas, and attachments —
with the durable content format always being ordinary files you own and can open with any
editor.

> **Status: Phase 0 (Foundation) — under active development.** The desktop shell boots;
> feature surfaces land phase by phase (see the roadmap below).

## Why Knowledge Studio

- **Your files are the product.** Notes are Markdown; attachments are normal files; the
  SQLite index is a disposable, rebuildable cache. Delete the index and nothing is lost.
- **Local-first and offline-first.** No account, no telemetry, no hidden network requests.
  AI features are optional, off by default, and provider-neutral.
- **Portable by design.** Cross-platform path validation so a vault moves safely between
  Windows, macOS, and Linux (including Persian filenames).
- **AI-ready without lock-in.** A read-only local MCP server and provider-neutral AI
  interfaces are planned; the core product works with zero AI configured.

## Roadmap

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 0 | Workspace foundation: tooling, gates, ADRs, desktop shell | ✅ |
| 1 | Vault engine (atomic IO, traversal guards, watcher, trash) | planned |
| 2 | Markdown editor (tabs, explorer, properties, outline) | planned |
| 3 | Wiki links, backlinks, rename-aware updates | planned |
| 4 | Metadata: YAML frontmatter, typed properties panel | planned |
| 5 | Search: filename + SQLite FTS5, incremental index, rebuild | planned |
| 6 | Backlinks index + knowledge graph | planned |
| 7 | Tags, outline | planned |
| 8–12 | Templates, attachments, command palette, workspaces, canvas | planned |
| 13–18 | History, optional Git, plugins, MCP, AI bridge, semantic search | planned |
| 19–29 | Security hardening, import/export, RTL/Persian, performance, release | planned |

## Repository layout

```
KnowledgeStudio/
├── apps/desktop/          Electron shell + React renderer
├── packages/              Domain packages (shared, vault, search, graph, ...)
├── tests/                 Cross-package integration and e2e tests
├── docs/                  Architecture, ADRs, development and security docs
└── scripts/               Repository tooling
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design and
[docs/adr/](docs/adr/) for the reasoning behind major decisions.

## Development

Prerequisites: Node.js ≥ 22 and pnpm (enable with `corepack enable pnpm`, or run pnpm via
`corepack pnpm …` without installing anything globally).

```bash
corepack pnpm install      # install workspace dependencies
corepack pnpm lint         # ESLint
corepack pnpm typecheck    # TypeScript project references
corepack pnpm test         # Vitest
corepack pnpm build        # build all packages
corepack pnpm dev          # run the desktop app in dev mode
```

Every commit is expected to pass lint, typecheck, and tests. See
[CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

## License

Knowledge Studio code is MIT-licensed; see [LICENSE-NOTICE.md](LICENSE-NOTICE.md) for the
license statement and third-party dependency notices.
