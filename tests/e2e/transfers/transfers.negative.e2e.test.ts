import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  // Auth is provided by auth.setup.ts via storageState — start straight on the dashboard.
  await page.goto('/');
  await page.getByRole('link', { name: 'Transfer' }).click();
  await expect(page).toHaveURL('http://localhost:5173/transactions/transfer'); 
  const errorAlert = page.getByRole('alert');

  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.getByRole('option', { name: 'BUSINESS — $' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).fill('33333333-3333-3333-3333-333333333333');
  await page.getByRole('textbox', { name: 'Amount' }).fill('435');
  await page.getByRole('button', { name: 'Transfer' }).click();
  await expect(errorAlert).toBeVisible();
  await expect(errorAlert).toContainText('SELF_TRANSFER_NOT_ALLOWED');
});
