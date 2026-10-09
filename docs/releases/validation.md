# Tier 1 public release validation

Date: 2026-10-10. Platform: Windows x64. Node.js 24.18.0, pnpm 11.24.0,
Electron 44.0.0, Vitest 4.1.11.

| Check                                             | Result                                                          |
| ------------------------------------------------- | --------------------------------------------------------------- |
| Isolated clone and pinned dependency installation | Passed                                                          |
| TypeScript project build/typecheck                | Passed                                                          |
| ESLint / Prettier                                 | Passed                                                          |
| Unit/integration tests                            | 341 passed in 53 files                                          |
| Development Electron E2E                          | 13 passed; 2 packaged-only cases intentionally skipped          |
| Packaged executable E2E                           | 2 passed                                                        |
| Workspace/renderer build                          | Passed; known renderer bundle-size advisory remains             |
| Read-only MCP loopback smoke                      | 12 tools verified                                               |
| Search benchmark                                  | 1,000 synthetic notes / 1,000 matches                           |
| Bases benchmark                                   | 1,000 and 10,000 synthetic rows                                 |
| Production staging and packaged ASAR audits       | Passed                                                          |
| Windows x64 NSIS installer generation             | Passed; unsigned; not installed                                 |
| Bundled project license/notice files              | Verified                                                        |
| Source/history credential-pattern scan            | No credential matches; synthetic traversal-test path classified |
| Production dependency registry audit              | Zero registered advisories                                      |
| Full development dependency audit                 | One moderate build-only advisory; no high or critical           |

The known dependency advisory is documented in [dependency-security.md](dependency-security.md).
Pattern scanning and registry audits are limited evidence, not a security guarantee.
The screenshot uses a synthetic vault and masks the local vault path. macOS/Linux
runtime and installers have not been accepted for this release. No installed-app
acceptance or signing certificate is claimed.

The release was prepared in separate checkouts while preserving the original work.
Private audit logs, credentials, local agent state, test output, and user data are
excluded from the public repository and installer. Release downloads include SHA-256
checksums. Manual GitHub profile changes were not needed for this repository release.
