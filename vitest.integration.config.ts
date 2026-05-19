import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/integration/database/**/*.test.ts'],
    exclude: ['tests/integration/api/**'],
    globals: true,
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage/integration',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/generated/**', 'src/server.ts', "src/config/**"],
      // No per-suite thresholds — SonarQube Quality Gate is the single source
      // of truth for coverage enforcement, checked against the merged LCOV
      // (unit + integration + playwright-api + playwright-e2e). A per-suite
      // global threshold here would mis-fail because DB integration tests
      // only exercise src/repositories/**, not the entire src/** tree.
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
