# License Notice

## Project license

Knowledge Studio code is released under the **MIT License**:

> Copyright (c) 2026 Knowledge Studio contributors
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE
> OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Knowledge Studio is an original, clean-room implementation. It does not include, derive
from, or redistribute code, assets, or branding from any proprietary application.

## Third-party dependencies

The table below lists significant third-party dependencies and their licenses. It is
updated when dependencies are added (see CONTRIBUTING.md). Runtime dependencies ship
inside the application; build/test tooling does not.

| Dependency | Role | License |
| ---------- | ---- | ------- |
| Electron | Desktop runtime | MIT |
| React / React DOM | Renderer UI | MIT |
| Vite | Renderer build tool | MIT |
| TypeScript | Language / typechecking | Apache-2.0 |
| Vitest | Test runner | MIT |
| ESLint / typescript-eslint | Linting | MIT |
| Prettier | Formatting | MIT |

Planned (documented ahead of introduction): CodeMirror 6 (MIT), remark/unified (MIT),
better-sqlite3 or node:sqlite-backed layer (MIT / public domain for SQLite), Zod (MIT),
Cytoscape.js (MIT), Playwright (Apache-2.0).
