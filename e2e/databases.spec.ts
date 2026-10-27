import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique } from './fixtures';

const nameFieldValues = async (page: Page, id: string) => {
  const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
  const nameField = db.fields.find((f: any) => f.name === 'Name').id;
  return db.rows.map((r: any) => r.data[nameField] ?? '');
};

const main = (page: Page) => page.getByRole('main');
const rowNames = (page: Page) => main(page).locator('tbody .db-cell-input');

/** Creates a new page from the sidebar and turns it into a database with the type picker. */
async function newDatabaseFromSidebar(page: Page, title: string) {
  await page.getByRole('complementary').getByRole('button', { name: 'Public +' }).getByRole('button', { name: '+' }).click();
  await expect(main(page).getByText('Or select from one of these page types:')).toBeVisible();
  await main(page).getByRole('textbox', { name: 'Untitled page' }).fill(title);
  await main(page).getByRole('button', { name: /^Database Structured tables/ }).click();
  await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
  return page.url().split('/doc/')[1].split(/[?#]/)[0];
}

/**
 * Adds a row and types its name, then waits until the server has it. The test puts the cursor
 * in the name box directly: the box is narrow and partly covered by the row's page icon and
 * Open button, so a click lands on those as often as on the box.
 */
async function addNamedRow(page: Page, databaseId: string, name: string) {
  const before = await rowNames(page).count();
  await main(page).getByRole('button', { name: 'Add row' }).click();
  await expect(rowNames(page)).toHaveCount(before + 1);
  const input = rowNames(page).nth(before);
  await input.focus();
  await page.keyboard.type(name, { delay: 50 });
  await page.keyboard.press('Enter');
  await expect.poll(() => nameFieldValues(page, databaseId)).toContain(name);
}

test.describe('databases', () => {
  test('creates a database from a new page and saves its rows', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const title = unique('Tasks');
    const id = await newDatabaseFromSidebar(page, title);
    await expect(main(page).getByText('No rows yet.')).toBeVisible();

    await addNamedRow(page, id, 'Write tests');
    await addNamedRow(page, id, 'Ship it');
    expect(await nameFieldValues(page, id)).toEqual(['Write tests', 'Ship it']);

    // Still there after reopening the page.
    await page.goto(`/doc/${id}`);
    await expect(rowNames(page).nth(0)).toHaveValue('Write tests');
    await expect(rowNames(page).nth(1)).toHaveValue('Ship it');
  });

  test('shows rows added by someone else live', async ({ alice, bob, workspaceId }) => {
    await openPage(alice, await createPage(alice, workspaceId));
    const id = await newDatabaseFromSidebar(alice, unique('Shared tasks'));
    await bob.goto(`/doc/${id}`);
    await expect(main(bob).getByRole('button', { name: 'Add row' })).toBeVisible();

    await addNamedRow(alice, id, 'Added by Alice');
    await expect(rowNames(bob).nth(0)).toHaveValue('Added by Alice');
  });

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

  test("shows which cell someone else is editing", async ({ alice, bob, workspaceId }) => {
    await openPage(alice, await createPage(alice, workspaceId));
    const id = await newDatabaseFromSidebar(alice, unique('Busy table'));
    await addNamedRow(alice, id, 'Row one');
    await bob.goto(`/doc/${id}`);
    await expect(rowNames(bob).nth(0)).toHaveValue('Row one');

    await rowNames(alice).nth(0).focus();
    await alice.keyboard.press('End');
    const bobsCell = main(bob).locator('tbody .db-cell--presence');
    await expect(bobsCell).toHaveCount(1);
    await expect(bobsCell.locator('.db-cell-input')).toHaveValue('Row one');

    // When Alice leaves the cell, it's no longer marked for Bob.
    await rowNames(alice).nth(0).blur();
    await expect(bobsCell).toHaveCount(0);
  });

  test('a saved view filters and sorts rows, and keeps its settings', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Fruit'));
    for (const name of ['Banana', 'Apple', 'Cherry']) await addNamedRow(page, id, name);
    const views = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).views ?? [];

    await main(page).getByRole('button', { name: 'Create form view' }).click();
    await page.locator('.block-menu__item', { hasText: 'Filter & sort rows' }).click();
    await expect.poll(async () => (await views()).map((v: any) => v.name)).toEqual(['Table 1']);

    // Filter: Name is Banana.
    await main(page).getByRole('button', { name: 'Filter', exact: true }).click();
    const config = page.locator('.db-view-config-menu');
    await config.getByRole('button', { name: '+ Add filter' }).click();
    await config.getByPlaceholder('Value').fill('Banana');
    await expect(rowNames(page)).toHaveCount(1);
    await expect(rowNames(page).nth(0)).toHaveValue('Banana');
    await config.getByRole('button', { name: 'Remove filter' }).click();
    await expect(rowNames(page)).toHaveCount(3);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    // Sort: Name, descending.
    await main(page).getByRole('button', { name: 'Sort', exact: true }).click();
    await config.getByRole('button', { name: '+ Add sort' }).click();
    await config.locator('select').nth(1).selectOption('desc');
    const shown = async () => Promise.all((await rowNames(page).all()).map((input) => input.inputValue()));
    await expect.poll(shown).toEqual(['Cherry', 'Banana', 'Apple']);

    // The sort is saved with the view.
    await expect.poll(async () => (await views())[0]?.config?.sorts?.[0]?.direction).toBe('desc');
  });

  test('select, checkbox and number cells show and save their values', async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Typed'));
    await addNamedRow(page, id, 'First');
    const addField = async (data: Record<string, unknown>) => {
      const res = await page.request.post(`/api/pages/${id}/database/fields`, { data });
      expect(res.status()).toBe(201);
    };
    await addField({ name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } });
    await addField({ name: 'Done', type: 'CHECKBOX' });
    await addField({ name: 'Count', type: 'NUMBER' });
    await page.reload();
    const row = main(page).locator('tbody tr').first();

    // Multi-select: pick an option from the cell's menu; it shows as a pill.
    await row.locator('.db-multi-cell').click();
    await page.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Blue' }).click();
    await page.keyboard.press('Escape');
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();

    // Checkbox.
    await row.locator('td input[type="checkbox"]').last().check();

    // Number: only digits are kept.
    const number = row.locator('input[inputmode="decimal"]');
    await number.focus();
    await page.keyboard.type('4x2', { delay: 50 });
    await page.keyboard.press('Enter');
    await expect(number).toHaveValue('42');

    // All three are still there after reopening the page.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await expect(row.locator('td input[type="checkbox"]').last()).toBeChecked();
    await expect(number).toHaveValue('42');
  });

  test("a change survives someone else opening the table, and a reload", async ({ alice, bob, workspaceId }) => {
    // Opening a table used to add the rows it loaded to the live document before syncing with the
    // server, competing with the server's copy of the same row; about half the time that wiped
    // recent changes for everyone.
    const id = await createPage(alice, workspaceId, { title: unique('Shared table'), kind: 'DATABASE' });
    const db = await (await alice.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    await alice.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } } });
    await alice.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: 'Row' } } });

    await alice.goto(`/doc/${id}`);
    const row = main(alice).locator('tbody tr').first();
    await row.locator('.db-multi-cell').click();
    await alice.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Blue' }).click();
    await alice.keyboard.press('Escape');
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await alice.waitForTimeout(1000);

    await bob.goto(`/doc/${id}`);
    const bobRow = main(bob).locator('tbody tr').first();
    await expect(bobRow.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await alice.reload();
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await bob.waitForTimeout(1500);
    await expect(bobRow.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
  });

  test("a change survives someone else opening the row's page", async ({ alice, bob, workspaceId }) => {
    // The properties at the top of a row's page connect to the same live document as the table,
    // and had the same problem as above.
    const id = await createPage(alice, workspaceId, { title: unique('Shared table'), kind: 'DATABASE' });
    const db = await (await alice.request.get(`/api/pages/${id}/database`)).json();
    const name = db.fields.find((f: any) => f.name === 'Name').id;
    await alice.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Tags', type: 'MULTI_SELECT', options: { choices: [{ value: 'Red' }, { value: 'Blue' }] } } });
    const created = await (await alice.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: 'Row' } } })).json();
    const ensured = await (await alice.request.post(`/api/database-rows/${created.id}/page`, { data: { pageId: id } })).json();
    const rowPageId = ensured.page?.id ?? ensured.row?.pageId;
    expect(rowPageId).toBeTruthy();

    await alice.goto(`/doc/${id}`);
    const row = main(alice).locator('tbody tr').first();
    await row.locator('.db-multi-cell').click();
    await alice.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Blue' }).click();
    await alice.keyboard.press('Escape');
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
    await alice.waitForTimeout(1000);

    await bob.goto(`/doc/${rowPageId}`);
    const tags = bob.locator('.page-properties__row', { hasText: 'Tags' });
    await expect(tags).toContainText('Blue');
    await bob.waitForTimeout(1500);
    await alice.reload();
    await expect(row.locator('.db-multi-pill', { hasText: 'Blue' })).toBeVisible();
  });
});
