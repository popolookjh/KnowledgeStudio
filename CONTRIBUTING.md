# Contributing to Knowledge Studio

Thanks for helping build a local-first knowledge tool. This document covers the working
agreements; for the design rationale see [ARCHITECTURE.md](ARCHITECTURE.md) and the
[ADRs](docs/adr/).

## Setup

```bash
corepack enable pnpm        # or use `corepack pnpm …` without enabling
corepack pnpm install
```

Node.js ≥ 22 required. Windows x64 is the current release target; macOS and Linux runtime and packaging acceptance are not yet verified.

## Quality gates

Every change must pass the following local checks:

```bash
corepack pnpm typecheck     # tsc -b (strict); generate declarations before typed lint
corepack pnpm lint          # ESLint (type-aware)
corepack pnpm test          # Vitest
corepack pnpm build         # all packages build
corepack pnpm format:check  # Prettier
```

## Ground rules

- **Plain Markdown is the contract.** Never add data to notes that only this app can
  read; never make content depend on the index.
- **Domain packages stay pure.** No Electron/React imports in `packages/*`; they must
  run in Node tests.
- **Errors are explicit.** Expected failures return `Result`; only programming errors
  throw. Error codes are stable API.
- **Security review for boundary changes.** Anything touching vault containment, IPC,
  HTML rendering, plugins, or MCP needs a corresponding test in the security suite.
- **Tests are part of the feature.** A PR without tests for new behavior is incomplete;
  bug fixes come with a regression test.
- **No placeholders.** Every completed claim must actually work. No TODO-as-feature,
  no tests that assert nothing, no disabled tests to get green.

## Commit conventions

Small, meaningful commits with a `type(scope): summary` subject, e.g.:

```
feat(vault): implement atomic writes and app trash
fix(search): incremental index after external rename
docs(adr): record decision on plugin permission tiers
```

`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf` are the recognized types.
Before committing: run the gates above.

## Adding a dependency

Prefer mature, permissively licensed (MIT/BSD/Apache-2.0/ISC) dependencies. Justify the
need in the PR, record it in [LICENSE-NOTICE.md](LICENSE-NOTICE.md), and avoid pulling a
framework where a small library suffices.

## Docs

User-facing behavior changes update the relevant doc in `docs/`; architectural decisions
get an ADR (`docs/adr/NNNN-title.md`, immutable once accepted — supersede, don't edit).
