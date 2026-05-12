import { test, expect } from '@playwright/test';

// The login journey tests the *act* of authenticating, so it must start from
// an unauthenticated state — override the suite-wide storageState (which logs
// Alice in via auth.setup.ts) with an empty one.
test.use({ storageState: { cookies: [], origins: [] } });

test('staff can sign in with valid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Email' }).fill('staff@nordicbank.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('password123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // the url should be the home page after login
  await expect(page).toHaveURL('http://localhost:5173/');

  // should have a token in localStorage after login
  const token = await page.evaluate(() => localStorage.getItem('nb_token'));
  expect(token).not.toBeNull();
});
