# ADR-0006: Renderer hardening and strict cross-platform vault paths

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 0, security review)

## Context

The app executes untrusted content daily (arbitrary Markdown, HTML inside it,
attachments, later plugin and MCP input) and holds the user's entire knowledge base.
The two highest-severity risks are renderer escape (XSS → privileged access) and
vault escape (path traversal outside the selected folder). Windows additionally
reinterprets many path shapes that macOS/Linux would accept, breaking vault
portability.

## Decision

**Renderer hardening (enforced from Phase 0):**

- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webviewTag: false`, no remote content.
- Strict CSP: `default-src 'self'; script-src 'self'`; styles/images/fonts limited to
  self (plus data URIs); dev-server origins allowed only for HMR.
- The only renderer→main channel is the contextBridge API with flat, serializable
  contracts. No `remote`, no `ipcRenderer` generics leaking into feature code.
- Absolute filesystem paths never cross the bridge; the renderer sees vault-relative
  paths only.

**Vault path validation (packages/shared, enforced before any filesystem call):**

- Vault paths are relative, `/`-separated; backslash, `..`, leading `/`, drive
  letters, UNC, NUL/control characters, Windows-forbidden characters (`<>:"|?*`),
  reserved device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, any casing), and
  trailing dot/space in segments are **rejected, not rewritten**, with a precise
  error reason.
- Unicode (including Persian) filenames are fully supported; caps: 255 per segment,
  1024 per path.

## Consequences

- Legitimate-but-exotic names (e.g. `aux.md`) cannot exist in a vault — an accepted
  portability trade-off, documented in user docs.
- Validation lives in a pure, exhaustively tested module; IO code can trust it.
- IPC contracts will be versioned and validated (Zod) as they grow (Phase 2+).
