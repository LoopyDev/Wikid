import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// Steps shared by the database tests.

export const nameFieldValues = async (page: Page, id: string) => {
  const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
  const nameField = db.fields.find((f: any) => f.name === 'Name').id;
  return db.rows.map((r: any) => r.data[nameField] ?? '');
};

export const main = (page: Page) => page.getByRole('main');

/** Sets a single relation cell (in row `row`) to the linked row named `label`, through its picker. */
export async function chooseRelation(page: Page, row: number, label: string) {
  const cell = main(page).locator('tbody tr').nth(row);
  await cell.locator('button.db-relation-cell, .db-relation-change').first().click();
  await page.locator('.db-multi-select-menu .db-multi-option', { hasText: label }).click();
}
export const rowNames = (page: Page) => main(page).locator('tbody .db-cell-input');

/** Creates a new page from the sidebar and turns it into a database with the type picker. */
export async function newDatabaseFromSidebar(page: Page, title: string) {
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
export async function addNamedRow(page: Page, databaseId: string, name: string) {
  await typeNewRow(page, name);
  await expect.poll(() => nameFieldValues(page, databaseId)).toContain(name);
}

/** Adds a row and types its name, without waiting for the server. */
export async function typeNewRow(page: Page, name: string) {
  const before = await rowNames(page).count();
  await main(page).getByRole('button', { name: 'Add row' }).click();
  await expect(rowNames(page)).toHaveCount(before + 1);
  const input = rowNames(page).nth(before);
  await input.focus();
  await page.keyboard.type(name, { delay: 50 });
  await page.keyboard.press('Enter');
}
