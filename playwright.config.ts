import { defineConfig, devices } from '@playwright/test';

const ALICE_STORAGE_STATE = 'tests/e2e/.auth/alice.json';

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  // Browser-driven e2e tests share a single dev-server backend and DB. Serialise
  // them so concurrent withdrawals/deposits don't race against each other's
  // balance/transaction assertions. The api-integration project uses its own
  // testcontainer per file and isn't affected in practice.
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

    // Setup chain: seed the dev DB, then log in once and snapshot Alice's JWT.
    {
      name: 'e2e-seed',
      testDir: './tests/e2e/setup',
      testMatch: 'seed.setup.ts',
    },
    {
      name: 'e2e-auth',
      testDir: './tests/e2e/setup',
      testMatch: 'auth.setup.ts',
      dependencies: ['e2e-seed'],
    },

    {
      name: 'e2e-chromium',
      testDir: './tests/e2e',
      testMatch: '**/*.test.ts',
      use: { ...devices['Desktop Chrome'], storageState: ALICE_STORAGE_STATE },
      dependencies: ['e2e-auth'],
    },
    {
      name: 'e2e-firefox',
      testDir: './tests/e2e',
      testMatch: '**/*.test.ts',
      use: { ...devices['Desktop Firefox'], storageState: ALICE_STORAGE_STATE },
      dependencies: ['e2e-auth'],
    },
    {
      name: 'e2e-webkit',
      testDir: './tests/e2e',
      testMatch: '**/*.test.ts',
      use: { ...devices['Desktop Safari'], storageState: ALICE_STORAGE_STATE },
      dependencies: ['e2e-auth'],
    },
  ],
});
