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
      '@knowledge-studio/metadata': path.join(repoRoot, 'packages/metadata/src/index.ts'),
      '@knowledge-studio/search': path.join(repoRoot, 'packages/search/src/index.ts'),
      '@knowledge-studio/tags': path.join(repoRoot, 'packages/tags/src/index.ts'),
      '@knowledge-studio/templates': path.join(repoRoot, 'packages/templates/src/index.ts'),
      '@knowledge-studio/attachments': path.join(repoRoot, 'packages/attachments/src/index.ts'),
      '@knowledge-studio/commands': path.join(repoRoot, 'packages/commands/src/index.ts'),
      '@knowledge-studio/settings': path.join(repoRoot, 'packages/settings/src/index.ts'),
      '@knowledge-studio/canvas': path.join(repoRoot, 'packages/canvas/src/index.ts'),
      '@knowledge-studio/history': path.join(repoRoot, 'packages/history/src/index.ts'),
      '@knowledge-studio/git': path.join(repoRoot, 'packages/git/src/index.ts'),
      '@knowledge-studio/plugin-sdk': path.join(repoRoot, 'packages/plugin-sdk/src/index.ts'),
      '@knowledge-studio/mcp': path.join(repoRoot, 'packages/mcp/src/index.ts'),
      '@knowledge-studio/ai-bridge': path.join(repoRoot, 'packages/ai-bridge/src/index.ts'),
      '@knowledge-studio/semantic-search': path.join(repoRoot, 'packages/semantic-search/src/index.ts'),
      '@knowledge-studio/security': path.join(repoRoot, 'packages/security/src/index.ts'),
      '@knowledge-studio/import-export': path.join(repoRoot, 'packages/import-export/src/index.ts'),
      '@knowledge-studio/rtl': path.join(repoRoot, 'packages/rtl/src/index.ts'),
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
