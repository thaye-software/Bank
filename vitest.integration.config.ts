import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/integration/database/*.test.ts'],
    exclude: ['tests/integration/api/**'],
    globals: true,
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 80,
        branches: 75,
      },
    },
  },
  resolve: {
    alias: {
      '@db': path.resolve(__dirname, './src/generated/prisma/client'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@domain': path.resolve(__dirname, './src/domain'),
      '@repositories': path.resolve(__dirname, './src/repositories'),
      '@config': path.resolve(__dirname, './src/config'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
    },
  },
});
