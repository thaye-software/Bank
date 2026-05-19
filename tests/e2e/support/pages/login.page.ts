import type { Page } from '@playwright/test';

export interface LoginCredentials {
  readonly email: string;
  readonly password: string;
}

export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
  }

  async signIn(credentials: LoginCredentials): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Email' }).fill(credentials.email);
    await this.page.getByRole('textbox', { name: 'Password' }).fill(credentials.password);
    await this.page.getByRole('button', { name: 'Sign in' }).click();
  }

  async storedToken(): Promise<string | null> {
    return this.page.evaluate(() => localStorage.getItem('nb_token'));
  }
}
