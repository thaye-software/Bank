import { test, expect } from '@playwright/test';

test('Happy path for transferring money', async ({ page }) => {
  // Auth is provided by auth.setup.ts via storageState — start straight on the dashboard.
  await page.goto('/');
  await page.getByRole('link', { name: 'Transfer' }).click();
  await expect(page).toHaveURL('http://localhost:5173/transactions/transfer'); 
  const savingsAlert = page.getByRole('alert');

  // transfer from SAVINGS to bussiness account
  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.getByRole('option', { name: 'SAVINGS — $' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).fill('33333333-3333-3333-3333-333333333333');
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('123');
  await page.getByRole('button', { name: 'Transfer' }).click()
  await expect(savingsAlert).toBeVisible();
  await expect(savingsAlert).toContainText('Transferred $123.00');

  // transfer from CHECKING to bussiness account
  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.getByRole('option', { name: 'CHECKING — $' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).fill('33333333-3333-3333-3333-333333333333');
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('321');
  await page.getByRole('button', { name: 'Transfer' }).click();
  await expect(savingsAlert).toBeVisible();
  await expect(savingsAlert).toContainText('Transferred $321.00');

  // transfer from BUSINESS to CHECKING account
  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.getByLabel('BUSINESS — $').getByText('BUSINESS — $').click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).fill('11111111-1111-1111-1111-111111111111');
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('213');
  await page.getByRole('button', { name: 'Transfer' }).click();
  await expect(savingsAlert).toBeVisible();
  await expect(savingsAlert).toContainText('Transferred $213.00');
});