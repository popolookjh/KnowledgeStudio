# Test Matrix

Knowledge Studio uses layered tests so the Markdown vault remains safe even when optional
surfaces are unavailable.

| Area | Coverage | Verification |
| --- | --- | --- |
| Shared path algebra | traversal, absolute/UNC/drive paths, reserved Windows names, Unicode/Persian | unit |
| Vault | create/open, atomic read/write, external mtime conflicts, rename, trash/restore, watcher, symlink escape | unit + integration-style temp vaults |
| Markdown | frontmatter split/parse, outline, sanitized preview (raw HTML/XSS/javascript URLs) | unit |
| Links | wiki syntax, aliases/headings, ambiguity, backlinks, unresolved targets | unit |
| Metadata | typed fields, unknown-property preservation, body-safe rewrite | unit |
| Search | SQLite FTS5 title/body/tag/alias, incremental update, rebuild, Persian content | unit with in-memory SQLite |
| Graph | graph data derives from the link index; no graph source of truth | component/data smoke |
| Tags | inline/nested/Persian/frontmatter tags, code exclusion, browser index | unit |
| Templates | limited variable expansion, no template code execution | unit |
| Attachments | binary copy, collision safety, relative links, missing/orphan report | unit/temp filesystem |
| Commands | duplicate guards, permissions, default command catalog | unit |
| Canvas | original versioned JSON, validation, node/edge lifecycle | unit |
| History | revisions, retention, diff, restore reads | unit/temp filesystem |
| Git | status/diff/selected commit only, command allowlist | unit/temp Git repo |
| Plugins | default-deny, high-risk approval, scoped capabilities | unit |
| MCP | loopback, POST-only, read-only tool allowlist; V2: JSON-RPC 2.0 envelopes, Host/Origin/Content-Type guards, cited chunk retrieval (Persian-aware), citation resolution, change feed, annotations, Bases | unit + HTTP integration + E2E |
| AI/semantic | zero-provider operation, privacy disclosure, optional embeddings/hybrid merge | unit |
| Security | link schemes, secret redaction, file-size limits | unit |
| Portability/RTL | non-destructive import/export, UTF-8, Persian/mixed direction/code LTR | unit |
| Operations | content-redacted logs, recovery selection, synthetic benchmark | unit + benchmark smoke |
| Bases | runtime-validated definitions/edits, vault-bound persistence, body-free row projection, trusted metadata edits (history, identity, change feed), 1k/10k benchmark | unit + temp vault + `bench:bases` |
| Web clipper | non-executing HTML→Markdown, unsafe scheme/script/iframe removal, image-as-link, input limits, collision-safe paths, web provenance + `source_imported` | unit + temp vault + E2E |
| PDF | vault-relative `.pdf` + signature checks, annotation sidecar validation/revisions, pdf provenance, annotation change events, cited Markdown export; pdf.js with WASM/XFA disabled, no eval, text layer only | unit + temp vault + E2E |
| Zotero | CSL-JSON/BibTeX/local-API parsing, unsafe URL drop, loopback-only GET, idempotent re-sync that follows renames and keeps user edits, zotero provenance + source_imported/updated | unit + temp vault + E2E (fake loopback Zotero) |
| Desktop | Electron process launch smoke | process smoke |
| Electron E2E | project-local vault/user-data fixture, preload bridge, workbench, notes/search/workspace/wiki/tags, history, Git diff, Plugin policy, MCP loopback lifecycle, AI disclosure, Graph and Canvas persistence, Bases table/cards/RTL keyboard Kanban, offline web clip ingestion, PDF reader highlights/notes/export, MCP Retrieval V2 from the running app, Zotero local API sync | Playwright Electron |

Every defect should receive a regression test. All root gates run the full matrix:
`lint`, `typecheck`, `test`, and `build`.
