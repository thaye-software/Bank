import type { Locator, Page } from '@playwright/test';

// UI labels in the "New Account" dropdown — match the option text shown to the user.
export type AccountTypeOption = 'Checking' | 'Savings' | 'Business';

// Domain enum values — match what is rendered in the Accounts table rows
// (account.type in client/src/pages/Accounts.tsx).
export type AccountTypeRow = 'CHECKING' | 'SAVINGS' | 'BUSINESS';

export class AccountsPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.getByRole('link', { name: 'Accounts' }).click();
  }

  async createAccount(type: AccountTypeOption): Promise<void> {
    await this.page.getByRole('button', { name: 'New Account' }).click();
    // CHECKING is the default in the form — skip the type picker to avoid an
    // unnecessary combobox interaction. SAVINGS and BUSINESS require selection.
    if (type !== 'Checking') {
      await this.page.getByRole('combobox', { name: 'Account type' }).click();
      await this.page.getByRole('option', { name: type }).click();
    }
    await this.page.getByRole('button', { name: 'Create account' }).click();
  }

  row(type: AccountTypeRow): Locator {
    return this.page.getByRole('row').filter({ hasText: type });
  }

  async getAccountId(type: AccountTypeRow): Promise<string> {
    const text = await this.row(type).locator('td').first().innerText();
    return text.trim();
  }
}
