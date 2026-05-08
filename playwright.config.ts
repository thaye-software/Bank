import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: undefined,
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
      testMatch: '**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'e2e-firefox',
      testDir: './tests/e2e',
      testMatch: '**/*.test.ts',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'e2e-webkit',
      testDir: './tests/e2e',
      testMatch: '**/*.test.ts',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
