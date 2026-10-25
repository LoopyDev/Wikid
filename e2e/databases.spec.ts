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
});
