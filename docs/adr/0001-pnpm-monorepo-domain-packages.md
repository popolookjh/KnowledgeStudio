# ADR-0001: pnpm workspace monorepo with focused domain packages

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 0)

## Context

Knowledge Studio spans multiple concerns — vault IO, Markdown parsing, metadata,
search, graph, editor UI, plugins, MCP, AI bridges — with different stability and
testability requirements. The vault engine and indexers must be testable in pure Node
without a GUI; the desktop app is just one consumer. A single-package application
would entangle Electron with domain logic and slow test cycles.

## Decision

Use a pnpm workspace monorepo:

- `apps/desktop` — the Electron application (main, preload, React renderer). The only
  place Electron/React are allowed.
- `packages/*` — focused domain packages, plain TypeScript, no Electron/React imports,
  each with its own tests. `packages/shared` holds primitives used by everything
  (`Result`, error taxonomy, vault path algebra, IDs).
- `tests/` — cross-package integration and e2e suites; package-level unit tests live
  next to their package.

Root scripts (`lint`, `typecheck`, `test`, `build`) run the same gates across the
workspace via `tsc -b` project references and Vitest.

## Consequences

- Domain logic is GUI-free and unit-testable in milliseconds.
- Dependency boundaries are enforced structurally, not by convention alone.
- Slightly more configuration overhead per package (tsconfig, package.json) — accepted.
- Internal packages are `private: true`; only the app ships.
