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
      forks: { singleFork: false },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage/integration',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/generated/**', 'src/server.ts', "src/config/**"],
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
