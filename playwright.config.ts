import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env['TEST_BASE_URL'] ?? 'http://localhost:5173',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  projects: [
    {
      name: 'api-integration',
      testDir: './tests/integration/api',
      testMatch: '**/*.test.ts',
    },
    {
      name: 'e2e-chromium',
      testDir: './tests/e2e',
      testMatch: '**/*.e2e.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
