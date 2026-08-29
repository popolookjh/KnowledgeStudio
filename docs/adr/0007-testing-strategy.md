# ADR-0007: Testing strategy and gate discipline

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 0)

## Context

The project promises "every declared completed feature must actually work" on a
codebase that mixes pure domain logic, filesystem behavior, UI, and later Electron IPC
and E2E flows. Different layers need different test mechanics; without discipline the
suite decays into slow, flaky, or vacuous tests.

## Decision

- **Runner:** Vitest for unit/integration/UI; Playwright for desktop E2E where
  practical (added when the editor phase lands).
- **Unit tests** live inside each package (`packages/x/tests`), run in Node, no IO
  beyond temp dirs where the subject requires it (e.g. vault engine).
- **Integration tests** live in `tests/integration`, exercising real flows across
  packages (vault → indexer → search → backlinks) on temporary fixture vaults.
- **Security tests** are a first-class suite covering traversal, sanitization, plugin
  permission boundaries, and MCP exposure; a security fix without a test is incomplete.
- **UI tests** use Testing Library (jsdom) for components; E2E covers the user journey
  (create vault → note → edit → link → search → restart).
- **Gate discipline:** `lint`, `typecheck`, `test`, `build` must pass before every
  commit. No skipped/empty tests, no unconditional `catch`, no TODO-as-feature.

## Consequences

- Slightly slower commits (full gates) — accepted; incremental `tsc -b`/Vitest keep it
  fast.
- The vault engine's tests must cover Windows/POSIX path behaviors on every OS,
  including Unicode/Farsi filenames and atomic-write failure injection.
