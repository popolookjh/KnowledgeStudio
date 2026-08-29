# Vault Data Format

Living document describing what Knowledge Studio writes on disk. The invariant: **a
vault must remain a plain folder of ordinary files**; everything app-owned lives in a
single reserved subdirectory and is rebuildable or regenerable.

## Vault layout

```
my-vault/                     ← an ordinary folder the user picks
├── notes/*.md                ← Markdown notes (user content, source of truth)
├── attachments/…             ← configurable attachments directory
└── .knowledge-studio/        ← app-owned, safe to delete entirely
    ├── index.db              ← SQLite index (FTS5, links, graph, metadata cache)
    ├── trash/                ← deleted items awaiting restore/purge
    └── logs/                 ← structured local logs, content-redacted
```

- `.knowledge-studio/` is reserved; the indexer and search never surface it as
  content. Deleting the whole directory is always safe (the app recreates it) —
  it contains no unique knowledge.
- Canvas boards are **user content**, stored as regular files
  (e.g. `boards/my-board.ks-canvas.json`) with a documented JSON schema — human
  inspectable, not app-owned.
- Note metadata lives in YAML frontmatter inside the notes themselves (Phase 4);
  the index caches it for search only.

## Path conventions

- Notes and attachments are addressed by vault-relative `/`-separated paths.
- Validation rules (see `packages/shared/src/vault-path.ts`): relative paths only,
  forward slashes only, no `..`, no drive letters/UNC, no Windows-forbidden or
  control characters, no reserved device names, no trailing dots/spaces,
  ≤ 255 chars per segment, ≤ 1024 per path. Unicode — including Persian — is
  first-class.
- These rules exist so a vault syncs/moves between Windows, macOS, and Linux without
  silent reinterpretation of names.

## Writes and deletion

- Note writes are atomic: write to a temp file in the same directory, then rename over
  the target, with the previous version kept in local history (Phase 13).
- Deletes move content into `.knowledge-studio/trash/` first; restoration is supported
  and purge requires explicit confirmation. External deletions are detected, never
  mimicked.
