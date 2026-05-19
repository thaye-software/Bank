import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as setup, expect } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ALICE_AUTH_FILE = path.resolve(__dirname, '../.auth/alice.json');

setup('authenticate as alice', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('alice@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait for the post-login redirect — proves the JWT is in localStorage and
  // the protected dashboard renders before we snapshot storageState.
  await expect(page).toHaveURL('http://localhost:5173/');
  const token = await page.evaluate(() => localStorage.getItem('nb_token'));
  expect(token).not.toBeNull();

  await page.context().storageState({ path: ALICE_AUTH_FILE });
});
