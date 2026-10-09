# Dependency security review — 2026-10-10

Production dependency audit found no registered advisories at validation time.
Build/test tooling patches are pinned in pnpm-workspace.yaml. Vitest was upgraded
to 4.1.11 to replace vulnerable test-worker and mocking dependencies. Production
application features and data formats are unchanged by these tooling updates.

## Remaining build-only advisory

sprintf-js 1.1.3 is an optional transitive dependency of the electron-builder
logging chain (global-agent / roarr). The registry advisory has no patched version:
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
It describes denial of service through unbounded precision specifiers. It is not
part of the production staging dependency tree. Treat build inputs as trusted;
this release does not claim an entirely advisory-free development dependency tree.

Package-registry audits do not cover every Electron/Chromium or application flaw.
See SECURITY.md for reporting and the release validation report for executed checks.
