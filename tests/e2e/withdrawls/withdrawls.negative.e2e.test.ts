import { test, expect } from '../fixtures';

// Negative E2E for the withdrawal flow. The exhaustive rule-by-rule rejection
// matrix lives at the unit/integration layer; this test exists to prove that
// when the backend rejects a withdrawal, the user-facing error UX surfaces it.
//
// Trigger: $10,000.01 single withdrawal — exceeds MAX_SINGLE_WITHDRAWAL ($10,000),
// so transaction.validator.ts returns AMOUNT_TOO_HIGH and the Withdraw page
// renders that code inside its destructive Alert.
test('shows AMOUNT_TOO_HIGH and does not record a transaction when withdrawal exceeds the per-tx max', async ({ page, withdrawPage, dashboardPage }) => {
  await withdrawPage.goto();
  await withdrawPage.withdraw('CHECKING', '10000.01');

  // 1. Correct error code surfaced in the alert
  const alert = withdrawPage.alert();
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('AMOUNT_TOO_HIGH');

  // 2. No success alert — the success and error alerts share role="alert", so
  //    after a rejection there must be exactly one alert (the error one).
  await expect(withdrawPage.alert()).toHaveCount(1);

  // 3. No side effect — navigate to the dashboard and confirm the recent-transactions
  //    list contains no $10000.01 row (the failed withdrawal must not be persisted).
  await dashboardPage.gotoViaSidebar();
  await expect(page).toHaveURL('http://localhost:5173/');

  await expect(dashboardPage.recentTransactionRows().filter({ hasText: '$10000.01' })).toHaveCount(0);
});
