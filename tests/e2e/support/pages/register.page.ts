import type { Page } from '@playwright/test';

export interface RegisterInput {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
}

export class RegisterPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
    await this.page.getByRole('link', { name: 'Register' }).click();
  }

  async register(input: RegisterInput): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Full name' }).fill(input.fullName);
    await this.page.getByRole('textbox', { name: 'Email' }).fill(input.email);
    await this.page.getByRole('textbox', { name: 'Password' }).fill(input.password);
    await this.page.getByRole('button', { name: 'Register' }).click();
  }
}
