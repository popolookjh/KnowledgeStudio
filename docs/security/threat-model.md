# Threat Model

Living document. The one-paragraph summary and the supported-version/reporting policy
live in the root [SECURITY.md](../../SECURITY.md); this file is the working model.

## Assets

1. **User knowledge** — the vault contents (notes, attachments, canvas boards).
   Irreplaceable; highest value.
2. **System access** — the user's OS account and filesystem beyond the vault.
3. **Confidentiality** — note contents must not leak to network endpoints, logs, or
   other processes without explicit action.
4. **Integrity of app state** — settings/index (rebuildable, but trust anchors for
   what the UI shows).

## Trust boundaries

```
Internet / other processes
      │  (no default egress; MCP loopback listener when enabled)
┌─────▼──────────────────────────────┐
│ Electron main process (privileged) │ ← vault IO, index, settings, plugins
└─────┬──────────────────────────────┘   (the security kernel)
      │ typed, validated IPC only
┌─────▼──────────────────────────────┐
│ Renderer (sandboxed, untrusted)    │ ← renders untrusted Markdown/HTML
└────────────────────────────────────┘
      ▲
      │ untrusted inputs: vault files, attachments, plugins, MCP clients,
      │ AI provider responses (all opt-in)
```

## Attack surfaces and mitigations

| #   | Surface      | Attack                                                                           | Mitigation                                                                                       | Status                               |
| --- | ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| 1   | Vault paths  | Traversal (`../`, backslash, drive letter, UNC, NUL) to read/write outside vault | Pure path algebra rejects before any IO (ADR-0006); security test suite                          | ✅ Phase 0                           |
| 2   | Renderer     | XSS in Markdown preview → renderer escape                                        | sandbox + context isolation; sanitized preview (no raw HTML by default); strict CSP              | partial → Phase 19                   |
| 3   | IPC          | Malicious renderer sends forged IPC                                              | contextBridge with flat validated contracts; capabilities checked in main                        | ✅ Phase 0 (base), grows per feature |
| 4   | Attachments  | SVG/HTML with scripts, zip bombs, huge files                                     | attachment policy: no script execution, size warnings, no preview for dangerous types            | Phase 9/19                           |
| 5   | Plugins      | Over-privileged or malicious plugins                                             | manifest permissions; default-deny; untrusted never auto-run; PROCESS_EXECUTE/SECRETS gated hard | Phase 15                             |
| 6   | MCP          | Local attacker abuses exposed tools; note exfiltration via client                | loopback bind only; read-only default; explicit per-tool permission; no shell/filesystem tools   | Phase 16                             |
| 7   | AI bridge    | Prompt injection via note content into provider calls; silent egress             | opt-in config; disclosure banner; AI output treated as untrusted text; no auto-exec              | Phase 17/18                          |
| 8   | Secrets      | API keys in vault/index/logs                                                     | secrets live outside vault in OS-protected storage; log redaction                                | Phase 25                             |
| 9   | Index        | Corrupted/malicious DB file drives UI                                            | index is untrusted cache: validate on read, discard-and-rebuild on inconsistency                 | Phase 5/24                           |
| 10  | Supply chain | Compromised dependency                                                           | minimal deps, permissive licenses, lockfile committed, review on additions                       | ongoing                              |

## Tier 1 additions

| Surface                      | Threat                                                                                  | Mitigation                                                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web clips                    | Hostile HTML (scripts, frames, `javascript:`/`data:` links, tracking images)            | non-executing HTML→Markdown in main; unsafe schemes dropped; images become links; URLs never fetched; 5 MB cap                                                                               |
| PDF reader                   | Malicious PDF (scripts, forms, links, parser bugs)                                      | bytes only cross IPC after `.pdf` path + `%PDF-` checks (100 MB cap); bundled pdf.js with WASM/XFA off, CSP without `unsafe-eval`; canvas + text layer only (no annotation/link/form layers) |
| Annotations / Bases / Zotero | Forged IPC payloads, path traversal, duplicate writes                                   | runtime validators on every `unknown` argument; vault-relative paths; revisioned stores; one serialized TrustedNoteWriter                                                                    |
| Zotero sync                  | Egress / credential exposure                                                            | loopback `127.0.0.1` GET only, port validated, no API keys, 5 s timeout, 20 MB cap                                                                                                           |
| MCP V2                       | Browser CSRF / DNS rebinding against the loopback server                                | reject any `Origin`, non-loopback `Host`, non-JSON bodies; read-only tool allowlist with input schemas                                                                                       |
| Renderer                     | Navigation to untrusted links, popups, device permissions, HTML injection from snippets | `will-navigate` + `setWindowOpenHandler` deny; all web permissions denied; search snippets rendered as text                                                                                  |

## Residual risks (accepted, documented)

- A user who manually opens a malicious `.ks-canvas.json`/note in another tool is
  outside our reach; we sanitize only what we render.
- Native modules (future SQLite driver) expand the trusted computing base; isolated
  behind `packages/indexer` with fuzz/robustness tests on the DB layer.

## Review triggers

Any change touching: IPC contracts, HTML/Markdown rendering, path handling, plugin
loading, MCP tooling, or network access requires an update here plus security tests.
