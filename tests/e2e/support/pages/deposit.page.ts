import type { Page } from '@playwright/test';
import type { AccountTypeRow } from './accounts.page';

export class DepositPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.getByRole('link', { name: 'Deposit' }).click();
  }

  async deposit(accountType: AccountTypeRow, amount: string): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Account' }).click();
    // Account options render as "TYPE — $balance" — match by prefix so the
    // option locator stays stable across whatever balance is currently shown.
    await this.page.getByRole('option', { name: new RegExp(`^${accountType} — `) }).click();
    await this.page.getByRole('textbox', { name: 'Amount' }).fill(amount);
    await this.page.getByRole('button', { name: 'Deposit' }).click();
  }
}
