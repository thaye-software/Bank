import { test, expect } from '@playwright/test';

// Negative E2E for the withdrawal flow. The exhaustive rule-by-rule rejection
// matrix lives at the unit/integration layer; this test exists to prove that
// when the backend rejects a withdrawal, the user-facing error UX surfaces it.
//
// Trigger: $10,000.01 single withdrawal — exceeds MAX_SINGLE_WITHDRAWAL ($10,000),
// so transaction.validator.ts returns AMOUNT_TOO_HIGH and the Withdraw page
// renders that code inside its destructive Alert.
test('shows AMOUNT_TOO_HIGH and does not record a transaction when withdrawal exceeds the per-tx max', async ({ page }) => {
  await page.goto('/transactions/withdraw');

  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'CHECKING — $' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('10000.01');
  await page.getByRole('button', { name: 'Withdraw' }).click();

  // 1. Correct error code surfaced in the alert
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('AMOUNT_TOO_HIGH');

  // 2. No success alert — the success and error alerts share role="alert", so
  //    after a rejection there must be exactly one alert (the error one).
  await expect(page.getByRole('alert')).toHaveCount(1);

  // 3. No side effect — navigate to the dashboard and confirm the recent-transactions
  //    list contains no $10000.01 row (the failed withdrawal must not be persisted).
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL('http://localhost:5173/');

  const txRows = page.locator('section', { hasText: 'Recent Transactions' }).locator('.space-y-2 > div');
  await expect(txRows.filter({ hasText: '$10000.01' })).toHaveCount(0);
});
