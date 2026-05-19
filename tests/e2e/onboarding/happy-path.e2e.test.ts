import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures';

// Start logged-out. The project default storageState authenticates as Alice
// (see playwright.config.ts), but this test exercises the registration spine
// from zero — Alice's session would short-circuit §1 and §2.
test.use({ storageState: { cookies: [], origins: [] } });

test('onboarding spine — register → KYC → first account → first deposit', async ({
  registerPage,
  kycPage,
  accountsPage,
  depositPage,
}) => {
  // One UUID per test invocation. Playwright runs the test once per project
  // (chromium / firefox / webkit), so each parallel browser gets its own
  // unique identity — emails and national IDs cannot collide across workers.
  const id = randomUUID();

  // §1. Register
  await registerPage.goto();
  await registerPage.register({
    fullName: id,
    email: `${id}@email.com`,
    password: id,
  });

  // §2. KYC — TEST- prefix on national ID triggers auto-approve
  //     (ENABLE_KYC_AUTO_APPROVE flag, banking-rules §9.3).
  await kycPage.goto();
  await kycPage.submit({
    fullName: id,
    dateOfBirth: '2000-12-12',
    nationalId: `TEST-${id}`,
    documentImageUrl: `http://localhost:1234/${id}`,
  });

  // §3. First account — CHECKING (default type).
  await accountsPage.goto();
  await accountsPage.createAccount('Checking');

  // §4. First deposit — prove the brand-new account can actually transact.
  await depositPage.goto();
  await depositPage.deposit('CHECKING', '500.00');

  // Spine assertion: deposited balance must be visible on the Accounts table.
  await accountsPage.goto();
  await expect(accountsPage.row('CHECKING')).toContainText('$500.00');
});
