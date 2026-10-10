# Changelog

All notable changes to Knowledge Studio are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/).

## [0.1.0-tier1] - 2026-10-10

### First public Tier 1 prerelease

- Markdown vault/editor, links/backlinks, metadata, tags, FTS5 search, graph,
  templates, canvas, attachments, history and selected-file Git workflows.
- Persian/RTL support, import/export, stable IDs, provenance and durable change feed.
- Bases table/cards/Kanban, desktop HTML clipping, PDF annotations/cited export,
  read-only MCP Retrieval V2 and Zotero offline/loopback integration.
- Plugin discovery/permission policy and optional AI provider configuration;
  third-party plugin execution and Tier 2 remain deferred.
- Verified unsigned Windows x64 packaging with project and PDF.js license texts,
  synthetic demo screenshot, release checksums and private vulnerability reporting.
- Patched build/test dependencies; one moderate build-only advisory remains
  documented in [dependency-security.md](docs/releases/dependency-security.md).

See [release notes](docs/releases/v0.1.0-tier1.md) and
[validation](docs/releases/validation.md) for scope and executed checks.

### Foundation details

### Added

- Phase 1 vault engine (`@knowledge-studio/vault`):
  - create/open lifecycle with reserved `.knowledge-studio/` application
    directory; refuses to initialize over unrelated content.
  - containment-safe IO: pure path validation plus realpath (symlink-escape
    resistant) checks; application directory unreachable through the vault API.
  - atomic text writes (temp file + rename, fsync), binary attachment reads,
    Persian/Unicode paths end to end.
  - external-edit detection via `expectedMtimeMs` conflict guard.
  - safe rename (never overwrites) and delete-to-application-trash with
    manifest, listing, and conflict-checked restore.
  - recursive watcher with debounced created/changed/deleted classification;
    enumerator for notes, attachments, folders, and other files.
- Phase 0 foundation:
  - pnpm workspace with strict TypeScript, ESLint, Prettier, and Vitest gates
    (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`).
  - `@knowledge-studio/shared`: `Result` type, `StudioError` taxonomy, cross-platform
    vault path algebra (traversal/UNC/drive-letter/reserved-name rejection, Unicode and
    Persian filename support), and ID generation — with unit tests.
  - Electron desktop shell: sandboxed, context-isolated renderer (`sandbox: true`,
    `nodeIntegration: false`, strict CSP), React app shell with dark/light theme.
  - Architecture docs and ADR-0001…0007.
