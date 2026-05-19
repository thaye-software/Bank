import { test, expect } from '../../support/fixtures';

// The login journey tests the *act* of authenticating, so it must start from
// an unauthenticated state — override the suite-wide storageState (which logs
// Alice in via auth.setup.ts) with an empty one.
test.use({ storageState: { cookies: [], origins: [] } });

test('staff can sign in with valid credentials', async ({ page, loginPage }) => {
  await loginPage.goto();
  await loginPage.signIn({ email: 'staff@nordicbank.com', password: 'password123' });

  await expect(page).toHaveURL('http://localhost:5173/');

  const token = await loginPage.storedToken();
  expect(token).not.toBeNull();
});
