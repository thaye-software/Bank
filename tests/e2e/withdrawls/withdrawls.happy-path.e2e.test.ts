import { test, expect } from '../fixtures';

test('Happy path for withdrawing money', async ({ page, withdrawPage, dashboardPage }) => {
  await withdrawPage.goto();
  await withdrawPage.withdraw('CHECKING', '123.85');
  await withdrawPage.withdraw('SAVINGS', '124.56');
  await withdrawPage.withdraw('BUSINESS', '999.99');

  await dashboardPage.gotoViaSidebar();
  await expect(page).toHaveURL('http://localhost:5173/');

  await expect(dashboardPage.accountCard('CHECKING')).toContainText('$');
  await expect(dashboardPage.accountCard('SAVINGS')).toContainText('$');
  await expect(dashboardPage.accountCard('BUSINESS')).toContainText('$');

  const txRows = dashboardPage.recentTransactionRows();
  await expect(txRows.filter({ hasText: 'CHECKING' }).filter({ hasText: '$' }).first()).toBeVisible();
  await expect(txRows.filter({ hasText: 'SAVINGS' }).filter({ hasText: '$' }).first()).toBeVisible();
  await expect(txRows.filter({ hasText: 'BUSINESS' }).filter({ hasText: '$' }).first()).toBeVisible();
});
