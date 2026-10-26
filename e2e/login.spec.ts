import { test, expect, USERS, DEMO_PASSWORD, signIn, unique } from './fixtures';

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

  test('a user the admin created chooses their own password before getting in', async ({ browser, page }) => {
    // The admin creates the account in the Users panel, leaving "choose their own password" ticked.
    const adminContext = await browser.newContext();
    await signIn(adminContext, USERS.admin.email);
    const admin = await adminContext.newPage();
    await admin.goto('/');
    await admin.getByRole('complementary').getByRole('button', { name: /Users/ }).click();
    await admin.getByRole('button', { name: '+ New user' }).click();
    const email = `${unique('new').replace(/\s/g, '-').toLowerCase()}@example.com`;
    await admin.getByPlaceholder('Display name').fill('New Person');
    await admin.getByPlaceholder('Email').fill(email);
    await admin.getByPlaceholder('Password').fill('given-pass');
    await expect(admin.getByLabel('Ask them to choose their own password when they first log in')).toBeChecked();
    await admin.getByRole('button', { name: 'Create', exact: true }).click();
    const row = admin.locator('.admin-user-row', { hasText: email });
    await expect(row.getByText('Must choose a new password')).toBeVisible();

    // They sign in with the given password, and have to choose a new one first.
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill('given-pass');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();

    await page.getByPlaceholder('Password you were given').fill('given-pass');
    await page.getByPlaceholder('New password', { exact: true }).fill('my-own-pass');
    await page.getByPlaceholder('Confirm new password').fill('my-own-pass');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('complementary').locator('.user-name')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);

    // The badge is gone, and the account is removed again.
    await admin.reload();
    await admin.getByRole('complementary').getByRole('button', { name: /Users/ }).click();
    await expect(row).toBeVisible();
    await expect(row.getByText('Must choose a new password')).toHaveCount(0);
    const users = await (await admin.request.get('/api/admin/users?adminId=x')).json();
    await admin.request.delete(`/api/admin/users/${users.find((u: any) => u.email === email).id}?adminId=x`);
    await adminContext.close();
  });
});
