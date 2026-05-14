import { test, expect } from '@playwright/test';

test('Happy path for withdrawing money', async ({ page }) => {
  // Auth is provided by auth.setup.ts via storageState — start straight on the dashboard.
  await page.goto('/');
  await page.getByRole('link', { name: 'Withdraw' }).click();
  await expect(page).toHaveURL('http://localhost:5173/transactions/withdraw'); 

  // Withdraw from CHECKING account
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByLabel('CHECKING — $').getByText('CHECKING — $').click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('1234.85');
  await page.getByRole('button', { name: 'Withdraw' }).click();

  // Withdraw from SAVINGS account
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'SAVINGS — $' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('1234.56');
  await page.getByRole('button', { name: 'Withdraw' }).click();
  
  // Withdraw from BUSINESS account
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'BUSINESS — $' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('9999.99');
  await page.getByRole('button', { name: 'Withdraw' }).click();


  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL('http://localhost:5173/'); 

  // assert 
  await expect(page.locator('.bg-card').filter({ hasText: 'CHECKING' })).toContainText('$');
  await expect(page.locator('.bg-card').filter({ hasText: 'SAVINGS' })).toContainText('$');
  await expect(page.locator('.bg-card').filter({ hasText: 'BUSINESS' })).toContainText('$');


  const txRows = page.locator('section', { hasText: 'Recent Transactions' }).locator('.space-y-2 > div');
  await expect(txRows.filter({ hasText: 'CHECKING' }).filter({ hasText: '$1234.85' }).first()).toBeVisible();
  await expect(txRows.filter({ hasText: 'SAVINGS' }).filter({ hasText: '$1234.56' }).first()).toBeVisible();
  await expect(txRows.filter({ hasText: 'BUSINESS' }).filter({ hasText: '$9999.99' }).first()).toBeVisible();
});
