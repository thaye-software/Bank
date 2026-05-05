import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts', 'tests/unit/**/*.test.ts'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/domain/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 90,
        branches: 85,
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
