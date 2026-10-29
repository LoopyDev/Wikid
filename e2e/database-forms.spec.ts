import { test, expect, createPage, openPage, unique } from './fixtures';
import { main, newDatabaseFromSidebar } from './database-helpers';

// A database's forms: building one and editing its messages.

test.describe('database forms', () => {
  test('builds a form: a required field, a success message, and a preview', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Sign-ups'));
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];

    await main(page).getByRole('button', { name: /^Forms/ }).click();
    // "Form name" (prompt), then "Generate form fields from current database columns?" (confirm).
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Sign-up form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).map((f: any) => f.name)).toEqual(['Sign-up form']);

    const builder = main(page).locator('.db-form-builder');
    const nameField = builder.locator('.db-form-field', { hasText: 'Name' });
    await expect(nameField).toBeVisible();
    await nameField.getByLabel('Required').check();
    const message = builder.getByPlaceholder('Thanks! Your response has been saved.');
    await message.fill('Thanks for signing up');
    await message.press('Tab');

    const stored = async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      const config = form?.config ?? form?.fields?.config ?? {};
      return { required: fields.some((f: any) => f.required), message: config.successMessage };
    };
    await expect.poll(stored).toEqual({ required: true, message: 'Thanks for signing up' });

    // The layout tab previews the form as people will fill it in.
    await builder.getByRole('button', { name: 'Layout' }).click();
    await expect(builder.locator('form').getByText('Preview only. Submissions are disabled.')).toBeVisible();
  });

  test("keeps a form message you're typing when another save finishes", async ({ alice: page, workspaceId }) => {
    // The form re-rendered when a save's response arrived and put back the stored (empty) message,
    // so what you'd typed was never saved.
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Sign-ups'));
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Sign-up form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);
    const builder = main(page).locator('.db-form-builder');
    const nameField = builder.locator('.db-form-field', { hasText: 'Name' });
    await expect(nameField).toBeVisible();

    // Hold the "Required" save's response back until the message has been typed.
    let released = false;
    await page.route('**/database-forms/**', async (route) => {
      if (route.request().method() === 'PATCH' && (route.request().postData() || '').includes('"fields"')) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        released = true;
      }
      await route.continue();
    });
    await nameField.getByLabel('Required').check();
    const message = builder.getByPlaceholder('Thanks! Your response has been saved.');
    await message.fill('Thanks for signing up');
    await expect.poll(() => released).toBe(true);
    await page.waitForTimeout(300);
    await expect(message).toHaveValue('Thanks for signing up');
    await message.press('Tab');
    await expect.poll(async () => {
      const [form] = await forms();
      return (form?.config ?? form?.fields?.config ?? {}).successMessage;
    }).toBe('Thanks for signing up');
  });
});
