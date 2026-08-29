import { defineConfig } from 'vitest/config';

export default defineConfig({
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
