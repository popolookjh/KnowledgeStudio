# ADR-0005: SQLite (FTS5) as the only index layer

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 5 planning)

## Context

Search, backlinks, and the graph need fast persistent structures over potentially
100,000 notes. Storing derived data in files inside the vault pollutes user content;
keeping it in memory does not survive restarts and does not scale. SQLite is embedded,
battle-tested, public-domain, and its FTS5 module provides ranked full-text search
including Unicode content.

## Decision

Use a single rebuildable SQLite database per vault (stored under the vault's
`.knowledge-studio/` application directory) with:

- FTS5 virtual tables for full-text content (title, path, body, tags, aliases) with
  per-query ranking and snippet highlighting.
- Relational tables for links (incoming/outgoing/unresolved), tags, and metadata.
- Incremental updates driven by vault watch events, plus an explicit `REBUILD INDEX`
  command that recreates the database from scratch.

The database driver is isolated behind `packages/indexer` so the backend (native
`better-sqlite3` in the Electron main process) never leaks into domain logic.

## Consequences

- Deleting the SQLite file must never lose knowledge — enforced by tests.
- One canonical rebuild path avoids drift between incremental and full indexing.
- On machines without FTS5 the app must still boot (filename search + in-memory
  fallback), degrading gracefully.
