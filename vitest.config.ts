import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts', 'src/generated/**', 'src/server.ts', 'src/config/**'],
      all: true,
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
