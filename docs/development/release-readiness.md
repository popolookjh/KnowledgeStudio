# Release Readiness — Development Build

This checklist validates a **local Windows development build**. It neither signs,
publishes, nor pushes anything.

## Automated gates

Run from the repository root:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:e2e
corepack pnpm build
node scripts/search-benchmark.mjs 1000
```

Expected: all commands exit successfully; the benchmark returns JSON with 1,000
matches. The benchmark uses in-memory synthetic data only.

## Electron smoke

1. Start the built desktop app (`apps/desktop/node_modules/.bin/electron apps/desktop`).
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
