import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Workspace packages resolve to their TypeScript sources during tests so
    // suites always run against fresh code without a prior build.
    alias: {
      '@knowledge-studio/shared': path.join(repoRoot, 'packages/shared/src/index.ts'),
      '@knowledge-studio/vault': path.join(repoRoot, 'packages/vault/src/index.ts'),
      '@knowledge-studio/markdown': path.join(repoRoot, 'packages/markdown/src/index.ts'),
      '@knowledge-studio/links': path.join(repoRoot, 'packages/links/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: [
      'packages/*/tests/**/*.test.ts',
      'apps/*/src/**/*.test.{ts,tsx}',
      'tests/integration/**/*.test.ts',
    ],
  },
});
