import type { Page } from '@playwright/test';
import { test, expect, createPage, unique } from './fixtures';
import { main } from './database-helpers';

// A select's choices in colours: a single select's too, set in its options; its cells tinted; a
// board's columns in their choice's colour, and a board's or gallery's cards coloured by a select
// chosen for the view.

/** A database with these select columns (choices with colours) and rows; its ids. */
async function databaseWith(page: Page, workspaceId: string, selects: Record<string, Array<[string, string | null]>>, rows: Array<Record<string, string>>) {
  const id = await createPage(page, workspaceId, { kind: 'DATABASE', title: unique('Coloured') });
  const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
  const fieldIds: Record<string, string> = { Name: db.fields.find((f: any) => f.name === 'Name').id };
  for (const [name, choices] of Object.entries(selects)) {
    const options = { choices: choices.map(([value, color]) => ({ value, color })) };
    fieldIds[name] = (await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name, type: 'SELECT', options } })).json()).id;
  }
  for (const row of rows) {
    const data = Object.fromEntries(Object.entries(row).map(([name, value]) => [fieldIds[name], value]));
    await page.request.post(`/api/pages/${id}/database/rows`, { data: { data } });
  }
  return { id, fieldIds };
}

const view = async (page: Page, id: string, name: string) => {
  const { views } = await (await page.request.get(`/api/pages/${id}/database`)).json();
  return views.find((v: any) => v.name === name);
};

test.describe('select colours', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("a single select's choices can be given colours, and its cells show them", async ({ alice: page, workspaceId }) => {
    const { id, fieldIds } = await databaseWith(page, workspaceId, { Status: [['Open', null], ['Done', null]] }, [{ Name: 'Write', Status: 'Open' }]);
    await page.goto(`/doc/${id}`);
    await main(page).locator('.db-header-button', { hasText: 'Status' }).click();
    await page.getByRole('button', { name: /^Opt\s*Options/ }).click();
    await page.locator('.db-option-row').nth(0).getByLabel('Option color').fill('#ff0000');
    await main(page).locator('.db-header-button', { hasText: 'Status' }).click(); // closes the menu, saving

    await expect
      .poll(async () => {
        const { fields } = await (await page.request.get(`/api/pages/${id}/database`)).json();
        return fields.find((f: any) => f.id === fieldIds.Status).options.choices.map((c: any) => c.color);
      })
      .toEqual(['#ff0000', null]);
    await expect(main(page).locator('tbody tr').first().locator('select.db-cell-input')).toHaveCSS('background-color', 'rgba(255, 0, 0, 0.18)');
  });

  test("a board's columns show their choice's colour, and its cards take the colour of the select chosen for them", async ({ alice: page, workspaceId }) => {
    const { id, fieldIds } = await databaseWith(
      page,
      workspaceId,
      { Status: [['To do', '#0000ff'], ['Done', null]], Priority: [['High', '#ff0000'], ['Low', '#00ff00']] },
      [{ Name: 'Write', Status: 'To do', Priority: 'High' }, { Name: 'Test', Status: 'To do', Priority: 'Low' }, { Name: 'Plan', Status: 'To do' }]
    );
    expect((await page.request.post(`/api/pages/${id}/database/views`, { data: { name: 'Board', type: 'BOARD', config: { groupFieldId: fieldIds.Status } } })).status()).toBe(201);
    await page.goto(`/doc/${id}`);
    await main(page).getByRole('button', { name: 'Board' }).click();
    const columnDot = (label: string) =>
      main(page).locator('.db-board__column').filter({ has: page.locator('.db-board__column-title', { hasText: new RegExp(`^${label}$`) }) }).locator('.db-board__column-dot');
    await expect(columnDot('To do')).toHaveCSS('background-color', 'rgb(0, 0, 255)');
    // A choice without a colour has no dot
    await expect(columnDot('Done')).toHaveCount(0);

    await main(page).getByLabel('Colour cards by').selectOption('Priority');
    const cardOf = (title: string) => main(page).locator('.db-board__card').filter({ has: page.locator('.db-board__card-title', { hasText: new RegExp(`^${title}$`) }) });
    await expect(cardOf('Write')).toHaveCSS('border-left-color', 'rgb(255, 0, 0)');
    await expect(cardOf('Test')).toHaveCSS('border-left-color', 'rgb(0, 255, 0)');
    await expect(cardOf('Plan')).not.toHaveClass(/db-board__card--colored/);
    await expect.poll(async () => (await view(page, id, 'Board')).config.cardColorFieldId).toBe(fieldIds.Priority);

    // Kept with the view
    await page.reload();
    await main(page).getByRole('button', { name: 'Board' }).click();
    await expect(cardOf('Write')).toHaveCSS('border-left-color', 'rgb(255, 0, 0)');
  });

  test("a gallery's cards take the colour of the select chosen for them too", async ({ alice: page, workspaceId }) => {
    const { id, fieldIds } = await databaseWith(page, workspaceId, { Priority: [['High', '#ff0000']] }, [{ Name: 'Write', Priority: 'High' }]);
    expect((await page.request.post(`/api/pages/${id}/database/views`, { data: { name: 'Cards', type: 'GALLERY', config: {} } })).status()).toBe(201);
    await page.goto(`/doc/${id}`);
    await main(page).getByRole('button', { name: 'Cards' }).click();
    await main(page).getByText('View options').click();
    await main(page).getByLabel('Colour cards by').selectOption('Priority');
    await expect(main(page).locator('.db-gallery__card').first()).toHaveCSS('border-left-color', 'rgb(255, 0, 0)');
    await expect.poll(async () => (await view(page, id, 'Cards')).config.cardColorFieldId).toBe(fieldIds.Priority);
  });

  test("a board's cards and columns are striped in their colours, or tinted; a gallery's cards too", async ({ alice: page, workspaceId }) => {
    const { id, fieldIds } = await databaseWith(
      page,
      workspaceId,
      { Status: [['To do', '#0000ff'], ['Done', null]], Priority: [['High', '#ff0000']] },
      [{ Name: 'Write', Status: 'To do', Priority: 'High' }]
    );
    const config = { groupFieldId: fieldIds.Status, cardColorFieldId: fieldIds.Priority };
    expect((await page.request.post(`/api/pages/${id}/database/views`, { data: { name: 'Board', type: 'BOARD', config } })).status()).toBe(201);
    expect((await page.request.post(`/api/pages/${id}/database/views`, { data: { name: 'Cards', type: 'GALLERY', config: { ...config, cardColorStyle: 'tint' } } })).status()).toBe(201);
    await page.goto(`/doc/${id}`);
    await main(page).getByRole('button', { name: 'Board' }).click();
    const column = (label: string) => main(page).locator('.db-board__column').filter({ has: page.locator('.db-board__column-title', { hasText: new RegExp(`^${label}$`) }) });
    const card = main(page).locator('.db-board__card').first();

    // Striped: a card down its left, a column along its top; a column whose choice has no colour, plain
    await expect(card).toHaveCSS('border-left-color', 'rgb(255, 0, 0)');
    await expect(column('To do')).toHaveCSS('border-top-color', 'rgb(0, 0, 255)');
    await expect(column('Done')).not.toHaveClass(/db-board__column--colored/);

    // Tinted: a soft background, and a card's border all round in its colour
    await main(page).getByLabel('Colour style').selectOption('Tint');
    // Over the card's own background, so the column's colour doesn't show through
    await expect(card).toHaveCSS('background-image', 'linear-gradient(rgba(255, 0, 0, 0.14), rgba(255, 0, 0, 0.14))');
    await expect(card).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(card).toHaveCSS('border-top-color', 'rgb(255, 0, 0)');
    await expect(column('To do')).toHaveCSS('background-image', 'linear-gradient(rgba(0, 0, 255, 0.1), rgba(0, 0, 255, 0.1))');
    // A tinted card still shows the hover highlight
    await card.hover();
    await expect(card).not.toHaveCSS('border-top-color', 'rgb(255, 0, 0)');
    await expect.poll(async () => (await view(page, id, 'Board')).config.cardColorStyle).toBe('tint');

    await main(page).getByRole('button', { name: 'Cards' }).click();
    await expect(main(page).locator('.db-gallery__card').first()).toHaveCSS('background-image', 'linear-gradient(rgba(255, 0, 0, 0.14), rgba(255, 0, 0, 0.14))');
  });
});
