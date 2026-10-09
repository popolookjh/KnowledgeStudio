# Release Readiness — Development Build

This checklist validates a **local Windows development build**. It neither signs,
publishes, nor pushes anything.

## Automated gates

Run from the repository root:

```bash
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
node scripts/search-benchmark.mjs 1000
```

Expected: all commands exit successfully; the benchmark returns JSON with 1,000
matches. The benchmark uses in-memory synthetic data only.

## Windows packaging validation

The local packaging flow uses electron-builder only. It is unsigned, never published, and the NSIS artifact is never executed or installed:

```bash
corepack pnpm package:stage
corepack pnpm package:audit:stage
corepack pnpm package:win:unpacked
corepack pnpm package:smoke
corepack pnpm package:win:nsis
corepack pnpm package:audit
```

The self-contained production staging tree is `release/stage/`; electron-builder writes
`release/out/win-unpacked/` and an unsigned `release/out/Knowledge-Studio-0.1.0-setup.exe`.
The packaged smoke launches the actual `KnowledgeStudio.exe` without a source app-directory
argument, with isolated project-local user data. It verifies the preload bridge, sandboxed
renderer, local vault workflows, Graph/Canvas, History, Git, Plugin policy, MCP loopback,
and offline AI settings. The targeted audit checks required runtime files and rejects source,
test fixtures, user data, secrets, local absolute paths, and LuckyAI references; it is not an
exhaustive secret scanner. Windows SmartScreen may warn because no certificate is used. An
installer is built for structural validation only and must not be installed on a development
machine. Attachment safe-copy and OS-backed AI credential controls are implemented in the desktop UI;
third-party plugin runtime execution remains deferred. Native attachment-dialog automation is not covered.

## Electron smoke

1. Launch the built development application (`corepack pnpm --filter @knowledge-studio/desktop start`).
2. Confirm the Electron main, renderer, GPU, and utility processes are alive.
3. Confirm no startup errors are written to stdout/stderr.
4. Close the process cleanly.

## Manual acceptance (before distribution)

- Create/open a normal Markdown folder as a vault.
- Create, edit, autosave, close, and reopen a note.
- Test a Persian filename and mixed Persian/English note.
- Add `[[wiki links]]`, inspect backlinks and graph.
- Search title/body/tags through Ctrl+P.
- Validate a canvas file can add, move, connect, save, and reopen nodes.
- Rebuild FTS5 index; verify search remains available.
- Verify malformed Markdown/YAML does not crash the app.
- Confirm no telemetry or network traffic occurs without an explicitly configured AI provider or optional MCP server.

## Security sign-off

- Renderer sandbox/context isolation/node integration configuration remains unchanged.
- Markdown preview sanitization tests pass.
- Vault traversal, symlink escape, reserved path, trash/restore, attachment,
  MCP allowlist, plugin permission, and redaction tests pass.
- No release step includes automatic push, reset, clean, rebase, force, or
  cloud upload.
