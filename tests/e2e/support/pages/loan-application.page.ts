import type { Locator, Page } from '@playwright/test';
import type { AccountTypeRow } from './accounts.page';

export type LoanTerm = 12 | 24 | 36 | 48 | 60;
export type EmploymentStatus = 'EMPLOYED' | 'SELF_EMPLOYED' | 'UNEMPLOYED' | 'RETIRED';

export interface LoanApplicationInput {
  readonly account: AccountTypeRow;
  readonly requestedAmount: string;
  readonly termMonths: LoanTerm;
  readonly annualIncome: string;
  readonly monthlyDebt: string;
  readonly age: string;
  readonly creditScore: string;
  // Defaults to EMPLOYED in the form — only set when a non-default value is needed.
  readonly employmentStatus?: EmploymentStatus;
}

const EMPLOYMENT_LABELS: Readonly<Record<EmploymentStatus, string>> = {
  EMPLOYED: 'Employed',
  SELF_EMPLOYED: 'Self-employed',
  UNEMPLOYED: 'Unemployed',
  RETIRED: 'Retired',
};

export class LoanApplicationPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/loans');
  }

  async apply(input: LoanApplicationInput): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Account' }).click();
    await this.page.getByRole('option', { name: new RegExp(`^${input.account} — `) }).click();

    await this.page.getByRole('spinbutton', { name: 'Requested amount ($)' }).fill(input.requestedAmount);

    await this.page.getByRole('combobox', { name: 'Term (months)' }).click();
    await this.page.getByRole('option', { name: `${input.termMonths} months` }).click();

    await this.page.getByRole('spinbutton', { name: 'Annual income ($)' }).fill(input.annualIncome);
    await this.page.getByRole('spinbutton', { name: 'Monthly debt ($)' }).fill(input.monthlyDebt);
    await this.page.getByRole('spinbutton', { name: 'Age' }).fill(input.age);
    await this.page.getByRole('spinbutton', { name: 'Credit score' }).fill(input.creditScore);

    // Employment status defaults to EMPLOYED — skip the picker unless the test
    // explicitly wants a different value (e.g. UNEMPLOYED for the R3 rejection).
    if (input.employmentStatus !== undefined && input.employmentStatus !== 'EMPLOYED') {
      await this.page.getByRole('combobox', { name: 'Employment status' }).click();
      await this.page.getByRole('option', { name: EMPLOYMENT_LABELS[input.employmentStatus] }).click();
    }

    await this.page.getByRole('button', { name: 'Submit Application' }).click();
  }

  // The post-submission card containing decision + amounts (or rejection alert).
  // Scopes assertions so we don't accidentally match content elsewhere on the page.
  getResultCard(): Locator {
    return this.page.locator('.bg-card').filter({ hasText: 'Application Result' });
  }

  // Destructive alert rendered inside the result card when the decision is REJECTED.
  // Currently surfaces the fallback "Application rejected" text because the frontend
  // reads data.errorCode but the backend returns data.rejectionCode — see the
  // mismatch in client/src/pages/LoanApplication.tsx.
  getRejectionAlert(): Locator {
    return this.getResultCard().getByRole('alert');
  }
}
