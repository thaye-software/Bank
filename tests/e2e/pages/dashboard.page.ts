import type { Locator, Page } from '@playwright/test';
import type { AccountTypeRow } from './accounts.page';

export class DashboardPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async gotoViaSidebar(): Promise<void> {
    await this.page.getByRole('link', { name: 'Dashboard' }).click();
  }

  // Account summary cards rendered on the dashboard. The .bg-card class is
  // applied by the Card UI primitive — filter by account type to scope.
  accountCard(type: AccountTypeRow): Locator {
    return this.page.locator('.bg-card').filter({ hasText: type });
  }

  // Rows inside the "Recent Transactions" section of the dashboard.
  recentTransactionRows(): Locator {
    return this.page
      .locator('section', { hasText: 'Recent Transactions' })
      .locator('.space-y-2 > div');
  }
}
