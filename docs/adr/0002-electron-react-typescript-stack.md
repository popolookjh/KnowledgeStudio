# ADR-0002: Electron + React + TypeScript as the desktop stack

- **Status:** Accepted
- **Date:** 2026-08-30
- **Deciders:** Core architecture (Phase 0)

## Context

The product needs a real desktop experience: multi-window-grade rendering, filesystem
watching, native menus, deep keyboard support, and later SQLite and canvas surfaces.
Options considered: Tauri (Rust toolchain dependency, smaller ecosystem for editor
complexities), pure web app (no local-first file access without a server), Electron
(mature, permissive license, largest ecosystem for this exact app class).

## Decision

Build on **Electron** with **TypeScript** end-to-end and a **React + Vite** renderer:

- Electron main process owns all privileged work (filesystem via domain packages,
  settings, index, later plugins/MCP servers).
- React renderer is a pure view layer driven by typed IPC contracts.
- Vite builds the renderer; `tsc -b` builds the main/preload processes (CommonJS output
  for sandbox-safe preloads).

## Consequences

- Larger install footprint and memory use than Tauri — accepted for ecosystem maturity
  and hire-ability; Electron's security model (sandbox, context isolation) is well
  understood and enforceable.
- TypeScript strict mode everywhere; `any` requires justification in review.
- The main/preload/renderer split is the security boundary; see ADR-0006.
