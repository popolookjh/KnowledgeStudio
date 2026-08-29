# ADR-0004: CodeMirror 6 as the Markdown editor kernel

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 2 planning)

## Context

The editor is the heart of the product: it must handle large Markdown files smoothly,
support mixed LTR/RTL (Persian) text, syntax-aware editing (headings, lists, tables,
code blocks), inline wiki-link affordances, and later plugin extensions. Options:
contentEditable-based rich editors (hard to control, XHTML noise), Monaco (IDE-weight,
wrong document model), CodeMirror 6 (module-scale, mobile-friendly, excellent
accessibility and RTL support, permissive MIT).

## Decision

Use **CodeMirror 6** as the editing kernel, wrapped in `packages/editor` behind our own
editor surface. Live preview will be implemented as CodeMirror decorations (syntax +
rendered elements in the same buffer) rather than a separate preview pane, with a
side-by-side source/preview mode also available. Markdown parsing for preview/indexing
uses the remark/unified ecosystem (MIT) so editor and indexer share one parser.

## Consequences

- Smallest viable core; extensions (wiki links, task lists, tables) load lazily.
- RTL: CodeMirror 6 supports bidirectional text; Farsi cursor behavior is realistic
  (Phase 21) where contentEditable hacks would not be.
- One Markdown grammar to maintain across editor, preview, link extraction, and index.
