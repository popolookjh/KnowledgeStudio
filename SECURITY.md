# Security Policy

Knowledge Studio is a local application that manages the user's personal knowledge. Its
security goals, in priority order:

1. **Content integrity** — nothing may destroy or corrupt the user's Markdown.
2. **Vault containment** — the app must never read or write outside the selected vault
   (plus its own app-data directory).
3. **Renderer isolation** — untrusted content (notes, HTML in Markdown, attachments,
   plugin output) must never gain code execution in a privileged context.
4. **Informed egress** — no network requests without explicit, visible configuration;
   no telemetry by default.

## Supported versions

During pre-1.0 development, security fixes land on the latest commit of `main`.

## Reporting a vulnerability

Please open a private security advisory via GitHub (Security → Advisories) or contact the
maintainer directly. Do not open a public issue for exploitable vulnerabilities. You will
get an acknowledgment within 7 days. We credit reporters in the changelog unless they
prefer to remain anonymous.

## Threat model (living summary)

| Threat | Mitigation |
| ------ | ---------- |
| Path traversal via crafted note names/links | All paths validated by vault path algebra before any filesystem access; backslashes, `..`, drive letters, UNC, reserved device names rejected (ADR-0006) |
| Malicious Markdown / unsafe HTML in preview | Preview renders sanitized HTML only; raw HTML blocked by default; external links flagged (Phase 19) |
| XSS through renderer | Sandbox + context isolation + `nodeIntegration: false`; strict CSP (`script-src 'self'`); no remote content |
| Compromised renderer → filesystem | Renderer has no Node access; filesystem only via typed IPC contracts in the main process |
| Malicious plugin | Permission manifest (vault read/write/delete, network, process, secrets tiers); `PROCESS_EXECUTE` and `SECRETS` highly restricted; untrusted plugins never auto-run (Phase 15) |
| MCP misuse | Local loopback only; read-only tool set by default; writes behind explicit user-granted permission; no shell/process/filesystem tools (Phase 16) |
| Prompt injection from AI-processed content | AI output rendered as untrusted text; no automatic tool execution from note content; AI features opt-in and disclosed (Phase 17–18) |
| Secret leakage | Secrets stored out of vault, out of index, out of logs; log redaction by default (Phase 25) |
| Attachment attacks (SVG/scripts, huge files) | Attachments stored outside index; dangerous types served with hardening headers; size warnings (Phase 9/19) |
| Index corruption | Index is disposable: discard-and-rebuild, content untouched (ADR-0005) |

## Hardening defaults (already enforced)

- Electron: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`,
  `webviewTag: false`.
- Strict CSP on the renderer: `script-src 'self'`, no remote origins, no `eval`.
- All vault paths validated before use; absolute filesystem paths never leave the
  main process.
- No telemetry, no analytics, no auto-updates phoning home, no cloud sync.

Planned controls (with their phases) are tracked in the threat model above and in
[docs/security/](docs/security/).
