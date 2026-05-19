import type { Locator, Page } from '@playwright/test';
import type { AccountTypeRow } from './accounts.page';

export class WithdrawPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/transactions/withdraw');
  }

  async withdraw(accountType: AccountTypeRow, amount: string): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Account' }).click();
    await this.page.getByRole('option', { name: new RegExp(`^${accountType} — `) }).click();
    await this.page.getByRole('textbox', { name: 'Amount' }).fill(amount);
    await this.page.getByRole('button', { name: 'Withdraw' }).click();
  }

  alert(): Locator {
    return this.page.getByRole('alert');
  }
}
