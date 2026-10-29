import { test, expect, createPage, openPage, unique, editor } from './fixtures';
import { main, chooseRelation, rowNames, newDatabaseFromSidebar, addNamedRow } from './database-helpers';

// A database's saved views: filters and sorts, gallery and list views, and each view's menu.

test.describe('database views', () => {
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

  test("a gallery's cover lists linked rows that open, up to a set number, and its cards show the columns chosen", async ({ alice: page, workspaceId }) => {
    const projects = await createPage(page, workspaceId, { title: unique('Projects'), kind: 'DATABASE' });
    const tasksTitle = unique('Tasks');
    const tasks = await createPage(page, workspaceId, { title: tasksTitle, kind: 'DATABASE' });
    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, projects, 'Website');

    const taskNames = ['Brief', 'Copy', 'Design', 'Build', 'Launch'];
    await page.goto(`/doc/${tasks}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    for (const name of taskNames) await addNamedRow(page, tasks, name);
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    for (let row = 0; row < taskNames.length; row += 1) await chooseRelation(page, row, 'Website');

    // Projects: a "Linked from" column, a Notes column, and a gallery with the linked tasks as its cover
    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Linked from' }).click();
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu input').fill('Notes');
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Text' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(4);
    expect((await page.request.post(`/api/pages/${projects}/database/views`, { data: { name: 'Cards', type: 'GALLERY', config: {} } })).status()).toBe(201);
    await page.reload();
    await main(page).getByRole('button', { name: 'Cards' }).click();
    await main(page).locator('.db-view-config-bar select').selectOption({ label: tasksTitle });

    const card = main(page).locator('.db-gallery__card').first();
    const cells = card.locator('.db-gallery__cover-item:not(.db-gallery__cover-more)');
    const more = card.locator('.db-gallery__cover-more');
    // Named after its column, then three, then "Show more" for the rest
    await expect(card.locator('.db-gallery__cover-label')).toHaveText(tasksTitle);
    await expect(cells).toHaveCount(3);
    await expect(more).toHaveText('Show 2 more');
    await more.click();
    await expect(cells).toHaveCount(5);
    await expect(more).toHaveText('Show less');
    await more.click();
    await expect(cells).toHaveCount(3);
    // Four at a time
    await main(page).getByLabel('Linked rows shown on a card before Show more').fill('4');
    await main(page).getByLabel('Linked rows shown on a card before Show more').press('Tab');
    await expect(cells).toHaveCount(4);
    await expect(more).toHaveText('Show 1 more');

    // The card shows Notes, until it's unticked
    await expect(card.locator('.db-gallery__field-name')).toHaveText(['Notes']);
    await main(page).locator('.db-card-fields__toggle').click();
    await main(page).locator('.db-card-fields__option', { hasText: 'Notes' }).locator('input').uncheck();
    await expect(card.locator('.db-gallery__field')).toHaveCount(0);

    // Kept with the view
    await page.waitForTimeout(800);
    await page.reload();
    await main(page).getByRole('button', { name: 'Cards' }).click();
    await expect(cells).toHaveCount(4);
    await expect(card.locator('.db-gallery__field')).toHaveCount(0);

    // A cell opens that task
    const first = (await cells.first().textContent())!.trim();
    await cells.first().click();
    await expect(page.locator('.page-overlay .page-overlay__title-input')).toHaveValue(first);
  });

  test('a list view shows a row per line with the properties chosen, here and in a page block', async ({ alice: page, workspaceId }) => {
    const db = await createPage(page, workspaceId, { title: unique('Reading'), kind: 'DATABASE' });
    const database = await (await page.request.get(`/api/pages/${db}/database`)).json();
    const nameField = database.fields.find((f: any) => f.name === 'Name').id;
    const notes = await (await page.request.post(`/api/pages/${db}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } })).json();
    for (const [name, note] of [['Dune', 'Re-read'], ['Emma', 'Next']]) {
      await page.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [nameField]: name, [notes.id]: note } } });
    }
    await page.goto(`/doc/${db}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();

    // A list view, from the add-view menu
    await main(page).getByRole('button', { name: 'Create form view' }).click();
    await page.locator('.block-menu__item', { hasText: 'One row per line' }).click();
    const rows = main(page).locator('.db-list__row');
    await expect(rows).toHaveCount(2);
    await expect(rows.locator('.db-list__name')).toHaveText(['Dune', 'Emma']);
    // No properties until chosen
    await expect(rows.locator('.db-list__property')).toHaveCount(0);
    await main(page).locator('.db-card-fields__toggle', { hasText: 'Properties' }).click();
    await main(page).locator('.db-card-fields__option', { hasText: 'Notes' }).locator('input').check();
    await expect(rows.locator('.db-list__property')).toHaveText(['Re-read', 'Next']);
    // The menu closes on a click elsewhere
    await page.mouse.click(5, 5);
    await expect(main(page).locator('.db-card-fields__menu')).toBeHidden();

    // A row's title opens it
    await rows.first().locator('.db-list__title').click();
    await expect(page.locator('.page-overlay .page-overlay__title-input')).toHaveValue('Dune');
    await page.keyboard.press('Escape');
    await expect(page.locator('.page-overlay')).toHaveCount(0);

    // In a page's database view block, chosen from its views
    await page.waitForTimeout(800);
    const doc = await createPage(page, workspaceId, { title: unique('Shelf') });
    await openPage(page, doc);
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const block = page.locator('.ce-database-view');
    await block.locator('.ce-database-view__view-select').selectOption({ label: 'List 1' });
    await expect(block.locator('.db-list__row .db-list__name')).toHaveText(['Dune', 'Emma']);
    await expect(block.locator('.db-list__row .db-list__property')).toHaveText(['Re-read', 'Next']);
  });

  test("a view is renamed and deleted from its own menu, not the filter menu", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Views'));
    const views = async () => ((await (await page.request.get(`/api/pages/${id}/database`)).json()).views ?? []).map((v: any) => v.name);
    await main(page).getByRole('button', { name: 'Create form view' }).click();
    await page.locator('.block-menu__item', { hasText: 'Filter & sort rows' }).click();
    await expect.poll(views).toEqual(['Table 1']);

    // Not in the filter menu any more
    await main(page).getByRole('button', { name: 'Filter', exact: true }).click();
    await expect(page.locator('.db-view-config-menu')).toBeVisible();
    await expect(page.locator('.db-view-config-menu').getByRole('button', { name: 'Delete view' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    // The view's ⋯ renames it
    const menu = page.locator('.db-view-menu');
    page.once('dialog', (dialog) => dialog.accept('Open tasks'));
    await main(page).getByRole('button', { name: 'Table 1 view options' }).click();
    await menu.getByRole('button', { name: 'Rename view' }).click();
    await expect(main(page).locator('.db-view-tab', { hasText: 'Open tasks' })).toBeVisible();
    await expect.poll(views).toEqual(['Open tasks']);

    // A right-click on its tab opens the same menu, which deletes it
    await main(page).locator('.db-view-tab', { hasText: 'Open tasks' }).click({ button: 'right' });
    page.once('dialog', (dialog) => dialog.accept());
    await menu.getByRole('button', { name: 'Delete view' }).click();
    await expect(main(page).locator('.db-view-tab', { hasText: 'Open tasks' })).toHaveCount(0);
    await expect.poll(views).toEqual([]);
  });
  test("a view's settings stay as chosen when its saves overlap", async ({ alice: page, workspaceId }) => {
    const db = await createPage(page, workspaceId, { title: unique('Overlap'), kind: 'DATABASE' });
    const database = await (await page.request.get(`/api/pages/${db}/database`)).json();
    const nameField = database.fields.find((f: any) => f.name === 'Name').id;
    const notes = await (await page.request.post(`/api/pages/${db}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } })).json();
    const status = await (await page.request.post(`/api/pages/${db}/database/fields`, { data: { name: 'Status', type: 'TEXT' } })).json();
    await page.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [nameField]: 'Dune', [notes.id]: 'Re-read', [status.id]: 'Done' } } });
    await page.request.post(`/api/pages/${db}/database/views`, { data: { name: 'Books', type: 'LIST', config: {} } });
    await page.goto(`/doc/${db}`);
    await main(page).getByRole('button', { name: 'Books' }).click();

    // The first save's reply comes back late, after the second's
    let held = false;
    await page.route(/\/api\/database-views\//, async (route) => {
      if (route.request().method() === 'PATCH' && !held) {
        held = true;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await route.fulfill({ response });
        return;
      }
      await route.continue();
    });
    const option = (name: string) => main(page).locator('.db-card-fields__option', { hasText: name }).locator('input');
    const properties = main(page).locator('.db-list__row').first().locator('.db-list__property');
    await main(page).locator('.db-card-fields__toggle', { hasText: 'Properties' }).click();
    await option('Notes').check();
    await expect.poll(() => held).toBe(true);
    await option('Status').check();
    await expect(properties).toHaveText(['Re-read', 'Done']);
    // Once the late reply is in, both still show
    await page.waitForTimeout(3500);
    await expect(properties).toHaveText(['Re-read', 'Done']);
  });
});
