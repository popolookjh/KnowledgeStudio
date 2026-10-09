# ADR-0003: Content, index, and application state are strictly separated

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 0)

## Context

Knowledge tools fail their users when proprietary formats or databases become the
de-facto source of truth: export is lossy, corruption is catastrophic, third-party
tooling dies. The product promise is that the user's notes remain ordinary files,
usable without Knowledge Studio, forever.

## Decision

Three strictly separated layers:

1. **Content** — Markdown notes, `.ks-canvas.json` boards, attachments in the vault
   folder. This is the _only_ source of truth.
2. **Index** — SQLite databases (search/FTS5, backlinks, graph, metadata cache,
   embedding references). Fully derived from content; a `REBUILD INDEX` command
   recreates everything from the vault; corruption is answered with
   discard-and-rebuild, never content modification.
3. **Application state** — settings, layout, open tabs, recents. Stored as JSON in the
   app-data directory, versioned and validated. Never written into notes; never needed
   to open a vault.

## Consequences

- Every indexer must be idempotent and rebuildable; this is enforced by integration
  tests that delete the index and rebuild.
- Features must degrade gracefully with a missing/stale index rather than require it.
- We cannot rely on SQLite-only tricks (e.g. as canonical storage for metadata);
  frontmatter in the Markdown itself stays canonical.
