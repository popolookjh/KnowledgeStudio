# Provenance Storage

Phase 31 stores durable provenance metadata at `.knowledge-studio/provenance.json`.

The file is application-owned state rather than Markdown content: Markdown frontmatter remains authoritative for the stable document ID, while provenance records describe source relationships, optional citation metadata, and locators without copying note/PDF/web content. The V1 snapshot is versioned, coupled to the stable vault ID, revisioned for optimistic updates, and atomically replaced with the vault atomic-write primitive.

A missing file means no provenance records. Invalid, unsupported, or foreign-vault snapshots are rejected without replacement. A missing source remains represented as missing during resolution; records are never silently deleted. Duplicate document IDs resolve as an explicit ambiguous state with deterministic vault-relative paths, never an arbitrary winner.

PDF, web, Zotero, annotation, change-feed, and import behavior are intentionally deferred to their later phases. URLs and local references are metadata only and are never fetched, opened, or treated as executable navigation by this package.
