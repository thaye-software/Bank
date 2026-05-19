import type { Page } from '@playwright/test';

export interface KycSubmission {
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly nationalId: string;
  readonly documentImageUrl: string;
}

export class KycPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.getByRole('link', { name: 'KYC' }).click();
  }

  async submit(input: KycSubmission): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Full name' }).fill(input.fullName);
    await this.page.getByRole('textbox', { name: 'Date of birth' }).fill(input.dateOfBirth);
    await this.page.getByRole('textbox', { name: 'National ID number' }).fill(input.nationalId);
    await this.page.getByRole('textbox', { name: 'Document image URL' }).fill(input.documentImageUrl);
    await this.page.getByRole('button', { name: 'Submit KYC' }).click();
  }
}
