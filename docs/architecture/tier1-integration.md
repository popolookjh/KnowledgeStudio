# Tier 1 Integration

Tier 1 adds Bases, web clipping, a PDF reader with annotations, MCP Retrieval V2, and Zotero
integration on top of the existing identity, provenance, and change-feed foundation.

## One trusted write path

Every main-process write of a note goes through `TrustedNoteWriter`
(`apps/desktop/electron/trusted-note-writer.ts`). It:

1. refuses stale writes (`expectedMtimeMs`) before touching history,
2. records the previous revision in the local history store,
3. assigns a stable document ID to Markdown (`ensureDocumentId`),
4. writes atomically through the Vault engine (vault-relative paths only), and
5. appends exactly one change-feed event, serialized so sequences never race.

The renderer has no filesystem authority. Each feature has a small host in the main process
that validates `unknown` IPC arguments at runtime before doing any work.

## Trusted change-feed producers

| Producer                                                    | Event types                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Editor save / new note (`vault:write`, `vault:create-note`) | `document_created`, `document_updated`                                                           |
| Rename / delete to trash                                    | `document_moved`, `document_deleted`                                                             |
| Attachment picker                                           | `attachment_added`                                                                               |
| Bases inline edit (`BasesHost.setField`)                    | `metadata_changed` (`metadata.field`)                                                            |
| Web clipper (`WebClipperHost`)                              | `source_imported` (`sourceType: web`)                                                            |
| PDF annotations (`PdfHost`)                                 | `annotation_created`, `annotation_updated`, `annotation_deleted`; exports are `document_created` |
| Zotero import/sync (`ZoteroHost`)                           | `source_imported`, `source_updated` (`sourceType: zotero`)                                       |
| Integrity repair (`IntegrityHost`)                          | `document_updated` (`metadata.repair`)                                                           |

External edits observed by the watcher update the UI and search index but are not feed events:
the feed records only trusted, attributable writes.

## Flows

- **Clip → Base → edit:** a clip becomes `Clippings/<title>.md` with `type: web-clip` and
  `source`; a Base over `Clippings` shows it; editing `status` inline rewrites only frontmatter.
- **PDF → annotation → literature note:** highlights live in `<pdf>.ks-annotations.json`
  (plain vault file, PDF untouched); export writes a note whose quotes cite `Title, p. N` and
  whose frontmatter carries the PDF `source_id`.
- **Zotero → literature notes:** items map to notes via provenance `externalSourceId`
  (`zotero:<key>`); re-sync updates source-owned fields in place, keeps user edits and tags,
  and follows renames through the stable document ID.
- **MCP Retrieval V2:** `retrieve` returns heading-level passages with `sourceId`, `documentId`,
  `chunkId`, and a compact citation; `resolve_citation` maps any `sourceId` (Markdown, web,
  PDF, Zotero) to its current location; `list_changes` exposes the feed for incremental sync.
- **Integrity:** the Knowledge integrity panel reports notes without IDs, duplicated IDs (copied
  files), invalid frontmatter, unresolved provenance, and the feed cursor; repair assigns or
  renews IDs through the trusted writer.

## Provenance source types

| Source                            | `sourceId`                         | Record                    |
| --------------------------------- | ---------------------------------- | ------------------------- |
| Markdown / web clip / Zotero note | `ks:<vaultId>:<documentId>`        | `documentId` + `localRef` |
| PDF                               | `ks:<vaultId>:<sidecar sourceKey>` | `localRef` = PDF path     |
