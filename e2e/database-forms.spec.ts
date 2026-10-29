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
  test('a date field can be filled in with today', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Intake'));
    const received = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Received', type: 'DATE' } })).json();
    await page.reload();
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Intake form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);

    // Autofill: Today, offered for the date field only
    const builder = main(page).locator('.db-form-builder');
    const autofill = (name: string) =>
      builder
        .locator('.db-form-field', { has: page.locator('.db-form-field-name', { hasText: new RegExp(`^${name}$`) }) })
        .locator('.db-form-field-controls', { hasText: 'Autofill' })
        .locator('select');
    await expect(autofill('Name').locator('option[value="today"]')).toBeDisabled();
    await autofill('Received').selectOption('today');
    const autoOf = async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      return fields.find((f: any) => f.fieldId === received.id)?.auto ?? null;
    };
    await expect.poll(autoOf).toEqual({ type: 'today' });

    // The form shows today's date, and the entry has it
    const [form] = await forms();
    await page.goto(`/form/${form.id}`);
    const today = await page.evaluate(() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    });
    const dateInput = page.locator('input[type="date"]');
    await expect(dateInput).toHaveValue(today);
    await expect(dateInput).toBeDisabled();
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect.poll(async () => {
      const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
      return db.rows.map((row: any) => row.data[received.id]);
    }).toEqual([today]);
  });

  test("a date field set to no future won't take a later date", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Incidents'));
    const happened = await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Happened', type: 'DATE' } })).json();
    await page.reload();
    const forms = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).forms ?? [];
    await main(page).getByRole('button', { name: /^Forms/ }).click();
    page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Incident form' : undefined));
    await main(page).getByRole('button', { name: 'New form' }).click();
    await expect.poll(async () => (await forms()).length).toBe(1);

    // Offered on the date field only
    const builder = main(page).locator('.db-form-builder');
    const fieldBlock = (name: string) =>
      builder.locator('.db-form-field', { has: page.locator('.db-form-field-name', { hasText: new RegExp(`^${name}$`) }) });
    await expect(fieldBlock('Name').getByLabel('No future')).toHaveCount(0);
    await fieldBlock('Happened').getByLabel('No future').check();
    await expect.poll(async () => {
      const [form] = await forms();
      const fields = Array.isArray(form?.fields) ? form.fields : form?.fields?.fields ?? [];
      return fields.find((f: any) => f.fieldId === happened.id)?.noFuture ?? false;
    }).toBe(true);

    const [form] = await forms();
    await page.goto(`/form/${form.id}`);
    const dayFrom = (offset: number) =>
      page.evaluate((offset) => {
        const day = new Date(Date.now() + offset * 86_400_000);
        return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      }, offset);
    const dateInput = page.locator('input[type="date"]');
    // The picker stops at today
    await expect(dateInput).toHaveAttribute('max', await dayFrom(0));
    await dateInput.fill(await dayFrom(2));
    await page.getByRole('button', { name: /^Submit/ }).click();
    // The browser holds the form back, saying the latest date it takes
    await expect.poll(() => dateInput.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(true);
    const dates = async () =>
      (await (await page.request.get(`/api/pages/${id}/database`)).json()).rows.map((row: any) => row.data[happened.id]);
    expect(await dates()).toEqual([]);

    const yesterday = await dayFrom(-1);
    await dateInput.fill(yesterday);
    await page.getByRole('button', { name: /^Submit/ }).click();
    await expect.poll(dates).toEqual([yesterday]);
  });
});
