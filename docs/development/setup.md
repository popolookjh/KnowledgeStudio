# Development Setup

## Prerequisites

| Tool | Version | Notes |
| ---- | ------- | ----- |
| Node.js | ≥ 22 | LTS recommended |
| pnpm | via corepack | `corepack enable pnpm`, or prefix commands with `corepack` |
| Git | any recent | line-ending normalization via `.gitattributes` |

No global installs beyond Node are required.

## First run

```bash
git clone <repo-url> KnowledgeStudio
cd KnowledgeStudio
corepack pnpm install
corepack pnpm build
corepack pnpm test
```

## Daily commands

| Command | Purpose |
| ------- | ------- |
| `corepack pnpm dev` | Run the desktop app with Vite HMR |
| `corepack pnpm build` | Build all packages (renderer, Electron main/preload) |
| `corepack pnpm test` | Run the full Vitest suite once |
| `corepack pnpm test:watch` | Watch mode |
| `corepack pnpm lint` / `format:check` | Lint / formatting checks |
| `corepack pnpm typecheck` | `tsc -b` across all project references |

## Platform notes

### Windows

- Git Bash, PowerShell, and cmd all work; scripts are cross-platform (`concurrently`,
  `wait-on`, `cross-env` where needed).
- Long-path support is recommended if you place the repo under a deep directory
  (`git config --global core.longpaths true`).
- The Electron binary download on first `pnpm install` can take a few minutes.

### macOS / Linux

- Fully supported for development. Windows is the primary release target; other
  platform packaging lands with the release phase.

## Troubleshooting

- **`pnpm` not found** — use `corepack pnpm …`; corepack ships with Node.
- **Electron postinstall skipped** — pnpm only runs lifecycle scripts for approved
  packages; `onlyBuiltDependencies` in `pnpm-workspace.yaml` already allows `electron`
  and `esbuild`. If you add a package needing a build script, add it there.
- **Stale build errors** — `tsc -b --clean` then `corepack pnpm typecheck`.
