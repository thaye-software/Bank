import { test as base } from '@playwright/test';
import { LoginPage } from './pages/login.page';
import { RegisterPage } from './pages/register.page';
import { KycPage } from './pages/kyc.page';
import { AccountsPage } from './pages/accounts.page';
import { DepositPage } from './pages/deposit.page';
import { WithdrawPage } from './pages/withdraw.page';
import { TransferPage } from './pages/transfer.page';
import { DashboardPage } from './pages/dashboard.page';

// One fixture per POM. Playwright instantiates each lazily — fixtures are only
// constructed for the tests that destructure them, so unused POMs cost nothing.
interface PomFixtures {
  loginPage: LoginPage;
  registerPage: RegisterPage;
  kycPage: KycPage;
  accountsPage: AccountsPage;
  depositPage: DepositPage;
  withdrawPage: WithdrawPage;
  transferPage: TransferPage;
  dashboardPage: DashboardPage;
}

export const test = base.extend<PomFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },
  kycPage: async ({ page }, use) => {
    await use(new KycPage(page));
  },
  accountsPage: async ({ page }, use) => {
    await use(new AccountsPage(page));
  },
  depositPage: async ({ page }, use) => {
    await use(new DepositPage(page));
  },
  withdrawPage: async ({ page }, use) => {
    await use(new WithdrawPage(page));
  },
  transferPage: async ({ page }, use) => {
    await use(new TransferPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
});

export { expect } from '@playwright/test';
