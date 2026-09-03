# Settings and Privacy Model

Settings are application state, not vault content. They are versioned and validated by
`@knowledge-studio/settings`; invalid or corrupted JSON falls back to defaults.

## Stored application state

- Theme: dark, light, or system.
- UI locale: English or Persian (`fa`).
- RTL note preference.
- Selected vault, open tabs, active note, editor mode.
- Sidebar/window layout values and recent file paths.

No note body is stored in workspace settings.

## Local defaults

- No telemetry.
- No cloud synchronization.
- No automatic network requests.
- No enabled AI provider.
- No enabled MCP listener.
- No automatically enabled third-party plugin.

## Optional integrations

AI providers and embeddings are provider-neutral interfaces. Remote providers require a
visible endpoint disclosure and explicit confirmation before vault contents can be sent.
The optional MCP server is read-only and loopback-only. Git integration does not push,
reset, clean, rebase, force, or auto-commit.

## Persian / RTL

The application is UTF-8 throughout. Persian filenames and content are supported in vault
paths, metadata, search, links, tags, templates, and import/export. Mixed-direction prose
uses automatic direction; fenced code blocks remain LTR.
