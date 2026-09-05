# Knowledge Studio UI Inventory

This inventory records the current desktop UI for a later Product Design audit. It contains no user data or secrets.

## Major surfaces

- **Welcome view:** create a vault or open an existing local Markdown vault.
- **Workbench:** title bar, vault actions, search, Graph, Canvas, index rebuild, new note, editor mode, and close-vault action.
- **Explorer:** vault-relative folders, notes, attachments, and file selection.
- **Editor:** CodeMirror Markdown editing with autosave and explicit save.
- **Preview:** sanitized Markdown rendering in split or preview mode.
- **Properties/Outline/Links:** frontmatter fields, headings, outgoing links, backlinks, and unresolved-link actions.
- **Attachments:** main-process file picker, safe copy into the vault, relative Markdown reference insertion, and missing/orphan diagnostics.
- **History:** local revisions, diff view, and explicit restore confirmation.
- **Git:** status, selected-file diff, and explicit selected commit.
- **Plugins:** local manifest discovery and default-deny/high-risk approval policy; runtime execution is deferred.
- **MCP:** active-vault loopback lifecycle and read-only tool status.
- **AI providers:** offline-by-default provider metadata, disclosure state, and OS-backed credential presence/set/replace/remove controls.
- **Graph:** lazy-loaded link graph overlay.
- **Canvas:** lazy-loaded persistent node canvas with selection, resize, zoom, and viewport persistence.
- **Status/error surfaces:** status bar, conflict banner, retry/close optional-view boundaries, and panel notices.

## Interaction and accessibility requirements

- Keep the editor as the primary workbench focus.
- Preserve semantic buttons, tree items, tabs, dialogs, alerts, and status regions.
- Every overlay needs an accessible close action, Escape behavior, visible focus, and focus return.
- Technical paths, branch names, hashes, code, and URLs should remain LTR within the Persian/RTL shell.
- Keyboard workflows must cover search, save, tab selection/close, overlay close, Canvas selection/delete/resize, and editor focus return.
- Empty, loading, unavailable, permission-denied, and failed states should explain the next safe action.

## RTL and Persian requirements

- Persian note names, tags, headings, backlinks, search queries, properties, history content, Graph labels, Canvas labels, plugin descriptions, MCP status, AI metadata, and dialogs must render without truncation or direction corruption.
- Mixed Persian/English/code content remains readable; code and identifiers use explicit LTR isolation where needed.
- Do not alter stored note content merely to change display direction.

## Known visual limitations

- The right sidebar is information-dense on narrower desktop windows.
- Graph and Canvas are modal overlays rather than dockable panels.
- Attachment diagnostics are currently a compact status list rather than a full attachment browser.
- No operational attachment picker automation is available without driving the native file dialog.
- The main renderer bundle remains above Vite's generic 500 kB advisory threshold.
