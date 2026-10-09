# Development Setup

## Prerequisites

| Tool    | Version      | Notes                                                      |
| ------- | ------------ | ---------------------------------------------------------- |
| Node.js | ≥ 22         | LTS recommended                                            |
| pnpm    | via corepack | `corepack enable pnpm`, or prefix commands with `corepack` |
| Git     | any recent   | line-ending normalization via `.gitattributes`             |

No global installs beyond Node are required.

## First run

```bash
git clone <repo-url> KnowledgeStudio
cd KnowledgeStudio
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm test
```

## Daily commands

| Command                               | Purpose                                                          |
| ------------------------------------- | ---------------------------------------------------------------- |
| `corepack pnpm dev`                   | Run the desktop app with Vite HMR                                |
| `corepack pnpm build`                 | Build all packages (renderer, Electron main/preload)             |
| `corepack pnpm test`                  | Run the full Vitest suite once                                   |
| `corepack pnpm test:e2e`              | Build then run deterministic Electron/Playwright E2E fixtures    |
| `corepack pnpm test:e2e:headed`       | Run the Electron E2E suite visibly for debugging                 |
| `corepack pnpm test:watch`            | Watch mode                                                       |
| `corepack pnpm lint` / `format:check` | Lint / formatting checks                                         |
| `corepack pnpm typecheck`             | `tsc -b` across all project references                           |
| `corepack pnpm package:stage`         | Build and materialize the self-contained production staging tree |
| `corepack pnpm package:audit:stage`   | Run the targeted staging security audit                          |
| `corepack pnpm package:win:unpacked`  | Build Windows x64 `win-unpacked` without running an installer    |
| `corepack pnpm package:smoke`         | Run packaged executable Playwright smoke against `win-unpacked`  |
| `corepack pnpm package:win:nsis`      | Revalidate unpacked smoke, then build an unsigned NSIS artifact  |
| `corepack pnpm package:audit`         | Audit staging and packaged ASAR contents                         |

## Platform notes

### Windows

- Git Bash, PowerShell, and cmd all work; scripts are cross-platform (`concurrently`,
  `wait-on`, `cross-env` where needed).
- Long-path support is recommended if you place the repo under a deep directory
  (`git config --global core.longpaths true`).
- The Electron binary download on first `pnpm install` can take a few minutes.

### macOS / Linux

- Development is intended to be portable, but runtime acceptance and packaging for
  these platforms have not been verified for this release.

## Troubleshooting

- **`pnpm` not found** — use `corepack pnpm …`; install Corepack separately if your Node distribution does not include it.
- **Electron postinstall skipped** — pnpm only runs lifecycle scripts for approved
  packages; `allowBuilds` in `pnpm-workspace.yaml` already allows `electron`
  and `esbuild`. If you add a package needing a build script, add it there.
- **Stale build errors** — `tsc -b --clean` then `corepack pnpm typecheck`.
