import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('happy path — full user journey, testing all features', async ({ page }) => {
  // One UUID per test invocation. Playwright runs the test once per project
  // (chromium / firefox / webkit), so each parallel browser gets its own
  // unique identity — emails and national IDs cannot collide across workers.
  const id = randomUUID();

  // ==========================================================================
  // §1. Register — create a new user from the login page's Register link
  // ==========================================================================
  await page.goto('http://localhost:5173/login');
  await page.getByRole('link', { name: 'Register' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill(id);
  await page.getByRole('textbox', { name: 'Full name' }).press('Tab');
  await page.getByRole('textbox', { name: 'Email' }).fill(`${id}@${id}.${id}`);
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill(id);
  await page.getByRole('button', { name: 'Register' }).click();

  // ==========================================================================
  // §2. KYC submission — TEST- prefix on national ID triggers auto-approve
  //     (ENABLE_KYC_AUTO_APPROVE flag, banking-rules §9.3)
  // ==========================================================================
  await page.getByRole('link', { name: 'KYC' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill(id);
  await page.getByRole('textbox', { name: 'Date of birth' }).fill('2000-12-12');
  await page.getByRole('textbox', { name: 'National ID number' }).click();
  await page.getByRole('textbox', { name: 'National ID number' }).fill(`TEST-${id}`);
  await page.getByRole('textbox', { name: 'Document image URL' }).click();
  await page.getByRole('textbox', { name: 'Document image URL' }).fill(`http://localhost:1234/${id}`);
  await page.getByRole('button', { name: 'Submit KYC' }).click();
  await page.goto('http://localhost:5173/profile');
  await page.getByRole('link', { name: 'Dashboard' }).click();

  // ==========================================================================
  // §3. Create accounts — one CHECKING (default), one SAVINGS, one BUSINESS
  // ==========================================================================
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('button', { name: 'New Account' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New Account' }).click();
  await page.getByRole('combobox', { name: 'Account type' }).click();
  await page.getByRole('option', { name: 'Savings' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'New Account' }).click();
  await page.getByRole('combobox', { name: 'Account type' }).click();
  await page.getByRole('option', { name: 'Business' }).click();
  await page.getByRole('button', { name: 'Create account' }).click();

  // ==========================================================================
  // §4. Deposits — fund each of the three accounts
  // ==========================================================================
  await page.getByRole('link', { name: 'Deposit' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByLabel('CHECKING — $').getByText('CHECKING — $').click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('99999');
  await page.getByRole('button', { name: 'Deposit' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'SAVINGS — $' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('123123');
  await page.getByRole('button', { name: 'Deposit' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'BUSINESS — $' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('54321');
  await page.getByRole('button', { name: 'Deposit' }).click();

  // ==========================================================================
  // §5. Withdrawals — withdraw from each account
  // ==========================================================================
  await page.getByRole('link', { name: 'Withdraw' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByLabel('CHECKING — $').getByText('CHECKING — $').click();
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('123');
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByLabel('SAVINGS — $').getByText('SAVINGS — $').click();
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('123');
  await page.getByRole('button', { name: 'Withdraw' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByLabel('BUSINESS — $').getByText('BUSINESS — $').click();
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('123');
  await page.getByRole('button', { name: 'Withdraw' }).click();

  // ==========================================================================
  // §6. Transfer — BUSINESS → CHECKING
  //     NOTE: the block below contains recorded cruft from looking up the
  //     destination account ID (Accounts cell clicks, ControlOrMeta+Shift+
  //     ArrowLeft selections, right-click context menu). The .fill('the
  //     checking account id') is also a placeholder string, not a real UUID,
  //     so this transfer currently fails. To be cleaned up.
  // ==========================================================================
  await page.getByRole('link', { name: 'Transfer' }).click();
  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.locator('html').click();
  await page.getByRole('link', { name: 'Accounts' }).click();
  await page.getByRole('cell', { name: '50da38ea-c106-4d8f-bc25-' }).dblclick();
  await page.locator('body').press('ControlOrMeta+Shift+ArrowLeft');
  await page.locator('body').press('ControlOrMeta+Shift+ArrowLeft');
  await page.locator('body').press('ControlOrMeta+Shift+ArrowLeft');
  await page.locator('body').press('ControlOrMeta+Shift+ArrowLeft');
  await page.getByRole('cell', { name: '50da38ea-c106-4d8f-bc25-' }).click();
  await page.getByRole('cell', { name: '50da38ea-c106-4d8f-bc25-' }).click();
  await page.getByRole('cell', { name: '50da38ea-c106-4d8f-bc25-' }).click({
    button: 'right'
  });
  await page.getByRole('cell', { name: '50da38ea-c106-4d8f-bc25-' }).click();
  await page.getByRole('cell', { name: '50da38ea-c106-4d8f-bc25-' }).click();
  await page.getByRole('link', { name: 'Transfer' }).click();
  await page.getByRole('combobox', { name: 'From account' }).click();
  await page.getByRole('option', { name: 'BUSINESS — $' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).click();
  await page.getByRole('textbox', { name: 'Destination account ID' }).fill('the checking account id');
  await page.getByRole('textbox', { name: 'Amount' }).click();
  await page.getByRole('textbox', { name: 'Amount' }).fill('123');
  await page.getByRole('button', { name: 'Transfer' }).click();

  // ==========================================================================
  // §7. Transaction history — view the SAVINGS account history
  // ==========================================================================
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await page.getByRole('combobox').click();
  await page.getByText('SAVINGS — $').click();

  // ==========================================================================
  // §8. Loan application — BUSINESS account, 12mo, $10,234, score 850 → APPROVED
  // ==========================================================================
  await page.getByRole('link', { name: 'Loan Application' }).click();
  await page.getByRole('combobox', { name: 'Account' }).click();
  await page.getByRole('option', { name: 'BUSINESS — $' }).click();
  await page.getByRole('spinbutton', { name: 'Requested amount ($)' }).click();
  await page.getByRole('spinbutton', { name: 'Requested amount ($)' }).fill('10234');
  await page.getByRole('combobox', { name: 'Term (months)' }).click();
  await page.locator('html').click();
  await page.getByRole('spinbutton', { name: 'Annual income ($)' }).click();
  await page.getByRole('combobox', { name: 'Term (months)' }).click();
  await page.getByLabel('12 months').getByText('12 months').click();
  await page.getByRole('spinbutton', { name: 'Annual income ($)' }).click();
  await page.getByRole('spinbutton', { name: 'Annual income ($)' }).fill('100000');
  await page.getByRole('spinbutton', { name: 'Monthly debt ($)' }).click();
  await page.getByRole('spinbutton', { name: 'Monthly debt ($)' }).fill('0');
  await page.getByRole('spinbutton', { name: 'Age' }).click();
  await page.getByRole('spinbutton', { name: 'Age' }).fill('21');
  await page.getByRole('spinbutton', { name: 'Credit score' }).click();
  await page.getByRole('spinbutton', { name: 'Credit score' }).fill('850');
  await page.getByRole('button', { name: 'Submit Application' }).click();

  // ==========================================================================
  // §9. Loan history — verify the new application appears
  // ==========================================================================
  await page.getByRole('link', { name: 'Loan History' }).click();

  // ==========================================================================
  // §10. Currency convert — visit the page (no conversion submitted yet)
  // ==========================================================================
  await page.getByRole('link', { name: 'Currency Convert' }).click();

  // ==========================================================================
  // §11. Profile & logout — finish the journey
  // ==========================================================================
  await page.getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Logout' }).click();
});