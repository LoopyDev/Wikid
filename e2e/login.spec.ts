import { test, expect, USERS, DEMO_PASSWORD } from './fixtures';

test.describe('signing in', () => {
  test('signs in with email and password, and stays signed in after a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill(USERS.alice.email);
    await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByRole('button', { name: /Wikid Workspace/ })).toBeVisible();
    await expect(page).toHaveURL(/\/doc\//);

    await page.reload();
    await expect(sidebar.getByRole('button', { name: /Wikid Workspace/ })).toBeVisible();
  });

  test('shows an error for a wrong password', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill(USERS.alice.email);
    await page.getByRole('textbox', { name: 'Password' }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
