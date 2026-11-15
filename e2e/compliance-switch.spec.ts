import { test, expect, createPage, USERS, signIn } from './fixtures';

// Compliance databases are an alpha feature: the admin turns them on in Admin → Settings. Off, a
// new page doesn't offer one. (The tests' global setup turns them on; this turns them off and back,
// so it runs once the other tests are done.)

test.describe('the compliance switch', { tag: '@shared-state' }, () => {
  test('off, a new page offers no compliance database; on, it does', async ({ alice: page, workspaceId, browser }) => {
    const adminContext = await browser.newContext();
    await signIn(adminContext, USERS.admin.email);
    const admin = await adminContext.newPage();
    await admin.goto('/');
    await admin.getByRole('complementary').getByRole('button', { name: /Settings/ }).click();
    const allowed = admin.getByLabel('Let people make compliance databases');
    await expect(allowed).toBeChecked();
    await allowed.uncheck();
    const available = async () => (await (await admin.request.get('/api/config')).json()).compliance.available;
    await expect.poll(available).toBe(false);

    try {
      // A new page's choices: no compliance database
      await page.goto(`/doc/${await createPage(page, workspaceId, { setupStatus: 'PENDING' })}`);
      const choices = page.getByRole('main');
      await expect(choices.getByRole('button', { name: /^Database Structured tables/ })).toBeVisible();
      await expect(choices.getByRole('button', { name: /Compliance database/ })).toHaveCount(0);
    } finally {
      await allowed.check();
      await expect.poll(available).toBe(true);
    }
    await page.reload();
    await expect(page.getByRole('main').getByRole('button', { name: /Compliance database/ })).toBeVisible();
    await adminContext.close();
  });
});
