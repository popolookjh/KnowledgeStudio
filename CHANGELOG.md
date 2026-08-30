# Changelog

All notable changes to Knowledge Studio are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/).

## [Unreleased]

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
