import type { Page } from '@playwright/test';
import { test, expect, createPage, openPage, unique, waitForSaved } from './fixtures';

const nameFieldValues = async (page: Page, id: string) => {
  const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
  const nameField = db.fields.find((f: any) => f.name === 'Name').id;
  return db.rows.map((r: any) => r.data[nameField] ?? '');
};

const main = (page: Page) => page.getByRole('main');

/** Sets a single relation cell (in row `row`) to the linked row named `label`, through its picker. */
async function chooseRelation(page: Page, row: number, label: string) {
  const cell = main(page).locator('tbody tr').nth(row);
  await cell.locator('button.db-relation-cell, .db-relation-change').first().click();
  await page.locator('.db-multi-select-menu .db-multi-option', { hasText: label }).click();
}
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
  await typeNewRow(page, name);
  await expect.poll(() => nameFieldValues(page, databaseId)).toContain(name);
}

/** Adds a row and types its name, without waiting for the server. */
async function typeNewRow(page: Page, name: string) {
  const before = await rowNames(page).count();
  await main(page).getByRole('button', { name: 'Add row' }).click();
  await expect(rowNames(page)).toHaveCount(before + 1);
  const input = rowNames(page).nth(before);
  await input.focus();
  await page.keyboard.type(name, { delay: 50 });
  await page.keyboard.press('Enter');
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

  test("keeps typing in a new row while the row before's page is still being made", async ({ alice: page, workspaceId }) => {
    await openPage(page, await createPage(page, workspaceId));
    const id = await newDatabaseFromSidebar(page, unique('Slow rows'));
    await expect(main(page).getByText('No rows yet.')).toBeVisible();
    // Each row's page arrives a little late, as on a slow server, so the first row's page lands
    // while the second row's name is being typed, and the table is redrawn under it
    await page.route(/\/api\/database-rows\/[^/]+\/page/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue();
    });

    await typeNewRow(page, 'Write tests');
    await typeNewRow(page, 'Ship it to everyone');
    await expect.poll(() => nameFieldValues(page, id)).toEqual(['Write tests', 'Ship it to everyone']);
  });

  test("a relation column's settings are laid out one under another, nothing overlapping", async ({ alice: page, workspaceId }) => {
    await createPage(page, workspaceId, { title: unique('Other database with a rather long name'), kind: 'DATABASE' });
    const id = await createPage(page, workspaceId, { title: unique('Related'), kind: 'DATABASE' });
    await page.goto(`/doc/${id}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await expect(page.locator('.db-add-column-menu')).toHaveCount(0);
    const menu = page.locator('.db-field-menu');
    await main(page).locator('thead th').nth(1).locator('button').first().click();
    await expect(menu).toBeVisible();
    // Short icons like "A-Z" stay on one line
    const iconHeight = async (item: string) =>
      (await menu.locator('.block-menu__item', { hasText: item }).first().locator('.block-menu__icon').boundingBox())!.height;
    expect(await iconHeight('Sort ascending')).toBe(await iconHeight('Type'));

    await menu.locator('.block-menu__item', { hasText: 'Relation' }).first().click();
    const parts = [
      menu.locator('.db-relation-settings__field'),
      menu.getByText('Allow multiple'),
      menu.getByText('Link a row to more than one row'),
      menu.getByText('Track history'),
      menu.getByText('Keep an append-only log of changes'),
    ];
    const boxes = [];
    for (const part of parts) {
      await expect(part).toBeVisible();
      boxes.push((await part.boundingBox())!);
    }
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].y, `part ${i} starts below the one before`).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 1);
    }
    // Each one fits in the menu (give or take a pixel of rounding, which differs between systems)
    const menuBox = (await menu.boundingBox())!;
    for (const box of boxes) expect(box.x + box.width).toBeLessThanOrEqual(menuBox.x + menuBox.width + 1);
  });

  test("a database view block's view picker follows the theme", async ({ alice: page, workspaceId }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    const db = await createPage(page, workspaceId, { title: unique('Viewed'), kind: 'DATABASE' });
    expect((await page.request.post(`/api/pages/${db}/database/views`, { data: { name: 'Open tasks', config: {} } })).status()).toBe(201);
    await openPage(page, await createPage(page, workspaceId));
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const picker = page.locator('.ce-database-view__view-select');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option', { hasText: 'Open tasks' })).toHaveCount(1);
    // In the page's colours, not the browser's white select, and its list drawn dark too
    const textColour = await page.locator('.ProseMirror').evaluate((el) => getComputedStyle(el).color);
    await expect(picker).toHaveCSS('color', textColour);
    await expect(picker).not.toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(picker).toHaveCSS('color-scheme', 'dark');
  });

  test("a database view block's title opens the database, and can be hidden from the block's menu", async ({ alice: page, workspaceId }) => {
    const dbTitle = unique('Stock');
    const db = await createPage(page, workspaceId, { title: dbTitle, kind: 'DATABASE' });
    const doc = await createPage(page, workspaceId, { title: unique('Report') });
    await openPage(page, doc);
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const block = page.locator('.ce-database-view');
    const title = block.getByRole('button', { name: dbTitle });
    await expect(title).toBeVisible();

    // The title opens the database's own page
    await title.click();
    await page.waitForURL(`**/doc/${db}`);
    await expect(page.getByRole('main').getByRole('textbox').first()).toHaveValue(dbTitle);
    await openPage(page, doc);
    await expect(title).toBeVisible();

    // Hidden from the block's menu; the table and its buttons stay
    const toggleTitle = async () => {
      await block.hover();
      await page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag').click();
      await page.locator('.block-menu').getByRole('button', { name: 'Show title' }).click();
    };
    await toggleTitle();
    await expect(block.locator('.ce-database-view__title')).toHaveCount(0);
    await expect(block.locator('.database-table')).toBeVisible();
    await waitForSaved(page);
    await page.reload();
    await expect(block.locator('.database-table')).toBeVisible();
    await expect(block.locator('.ce-database-view__title')).toHaveCount(0);
    await toggleTitle();
    await expect(title).toBeVisible();
  });

  test('the printed page keeps a database view block\'s title hidden, or shows it as a link', async ({ alice: page, workspaceId }) => {
    const dbTitle = unique('Stock');
    const db = await createPage(page, workspaceId, { title: dbTitle, kind: 'DATABASE' });
    const me = (await (await page.request.get('/api/auth/me')).json()).user;
    for (const showTitle of [false, true]) {
      const doc = await createPage(page, workspaceId, { title: unique('Report') });
      const content = { type: 'doc', content: [{ type: 'databaseView', attrs: { pageId: db, showTitle } }] };
      expect((await page.request.put(`/api/pages/${doc}/content`, { data: { content } })).status()).toBe(200);
      await page.goto(`/print/${doc}?userId=${me.id}&userName=${encodeURIComponent(me.displayName)}`);
      await expect(page.locator('.ce-database-view .database-table')).toBeVisible();
      await expect(page.locator('.ce-database-view').getByRole('button', { name: dbTitle })).toHaveCount(showTitle ? 1 : 0);
    }
  });

  test('a "Linked from" column shows the rows of another database that link to each row, and follows changes', async ({ alice: page, workspaceId }) => {
    const projects = await createPage(page, workspaceId, { title: unique('Projects'), kind: 'DATABASE' });
    const tasksTitle = unique('Tasks');
    const tasks = await createPage(page, workspaceId, { title: tasksTitle, kind: 'DATABASE' });

    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, projects, 'Website');
    await addNamedRow(page, projects, 'App');

    // Tasks link to a project
    await page.goto(`/doc/${tasks}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, tasks, 'Write copy');
    await addNamedRow(page, tasks, 'Pick a font');
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await chooseRelation(page, 0, 'Website');
    await chooseRelation(page, 1, 'Website');
    await expect(main(page).locator('tbody tr').nth(1).locator('.db-relation-pill')).toHaveText('Website');

    // Bugs relate to projects too
    const bugsTitle = unique('Bugs');
    const bugs = await createPage(page, workspaceId, { title: bugsTitle, kind: 'DATABASE' });
    await page.goto(`/doc/${bugs}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);

    // On Projects, a "Linked from" column: with two relations pointing here, it asks which to follow
    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await main(page).locator('thead th').last().locator('button').first().click();
    const addMenu = page.locator('.db-add-column-menu');
    await addMenu.locator('.block-menu__item', { hasText: 'Linked from' }).click();
    await expect(addMenu.locator('.block-menu__item .block-menu__title')).toHaveText([`${bugsTitle} › Column 2`, `${tasksTitle} › Column 2`]);
    await addMenu.locator('.block-menu__item', { hasText: tasksTitle }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    // Named after the database it shows
    await expect(main(page).locator('thead th').nth(1)).toContainText(tasksTitle);
    const linked = (row: number) => main(page).locator('tbody tr').nth(row).locator('td').nth(1);
    await expect(linked(0).locator('.db-multi-pill')).toHaveText(['Pick a font', 'Write copy']);
    await expect(linked(1)).toHaveText('—');
    // It can't be edited here
    await expect(linked(0).locator('input, select')).toHaveCount(0);

    // Its menu says what it follows
    await main(page).locator('thead th').nth(1).locator('button').first().click();
    const menu = page.locator('.db-field-menu');
    await menu.locator('.block-menu__item', { hasText: 'Linked from' }).click();
    await expect(menu.locator('select option:checked')).toContainText('› Column 2');
    await page.keyboard.press('Escape');

    // Linking another task, from another tab, shows here without a reload
    const other = await page.context().newPage();
    await other.goto(`/doc/${tasks}`);
    await expect(other.getByRole('main').locator('tbody tr')).toHaveCount(2);
    await chooseRelation(other, 1, 'App');
    await expect(linked(1).locator('.db-multi-pill')).toHaveText(['Pick a font'], { timeout: 20_000 });
    await expect(linked(0).locator('.db-multi-pill')).toHaveText(['Write copy']);
    await other.close();

    // A gallery shows them too, as a card's cover
    expect((await page.request.post(`/api/pages/${projects}/database/views`, { data: { name: 'Cards', type: 'GALLERY', config: {} } })).status()).toBe(201);
    await page.reload();
    await main(page).getByRole('button', { name: 'Cards' }).click();
    await main(page).locator('.db-view-config-bar select').selectOption({ label: tasksTitle });
    const cards = main(page).locator('.db-gallery__card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.db-gallery__cover-item')).toHaveText(['Write copy']);
    await expect(cards.nth(1).locator('.db-gallery__cover-item')).toHaveText(['Pick a font']);
  });

  test("a relation shows the rows it links to as pills that open them, and changes from its button", async ({ alice: page, workspaceId }) => {
    const projects = await createPage(page, workspaceId, { title: unique('Projects'), kind: 'DATABASE' });
    const tasks = await createPage(page, workspaceId, { title: unique('Tasks'), kind: 'DATABASE' });
    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, projects, 'Website');
    await addNamedRow(page, projects, 'App');
    await page.goto(`/doc/${tasks}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, tasks, 'Write copy');
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    const cell = main(page).locator('tbody tr').nth(0);
    const pills = cell.locator('.db-relation-pill');

    // Empty, the cell chooses one
    await chooseRelation(page, 0, 'Website');
    await expect(pills).toHaveText(['Website']);
    // The pill opens that project's page
    await pills.first().click();
    const overlay = page.locator('.page-overlay');
    await expect(overlay.locator('.page-overlay__title-input')).toHaveValue('Website');
    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);

    // The button changes it; choosing the one it has clears it
    await chooseRelation(page, 0, 'App');
    await expect(pills).toHaveText(['App']);
    await chooseRelation(page, 0, 'App');
    await expect(pills).toHaveCount(0);
    await chooseRelation(page, 0, 'App');

    // The task's own page shows it the same way
    await cell.locator('.db-page-input__open, .db-page-link__action').first().click();
    const properties = overlay.locator('.page-properties__relation');
    await expect(properties.locator('.db-relation-pill')).toHaveText(['App']);
    await properties.locator('.db-relation-pill').click();
    await expect(overlay.locator('.page-overlay__title-input')).toHaveValue('App');
  });

  test('moves columns from their menu or by dragging the header, and keeps the order', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId, { title: unique('Columns'), kind: 'DATABASE' });
    await page.goto(`/doc/${id}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    const headers = main(page).locator('thead th .db-header-label');
    for (const name of ['Alpha', 'Beta']) {
      await main(page).locator('thead th').last().locator('button').first().click();
      await page.locator('.db-add-column-menu input').fill(name);
      await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Text' }).click();
      await expect(headers.last()).toHaveText(name);
    }
    await expect(headers).toHaveText(['Name', 'Alpha', 'Beta']);
    const menu = page.locator('.db-field-menu');
    const openMenu = (name: string) => main(page).locator('thead th', { hasText: name }).locator('.db-header-button').click();

    // From the column's menu
    await openMenu('Beta');
    await menu.getByRole('button', { name: 'Move left' }).click();
    await expect(headers).toHaveText(['Name', 'Beta', 'Alpha']);
    // The first column can't go further left
    await openMenu('Name');
    await expect(menu.getByRole('button', { name: 'Move right' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Move left' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    // By dragging Alpha's header onto the left half of Name's
    await main(page).locator('thead th', { hasText: 'Alpha' }).locator('.db-header-button').evaluate((button) => {
      const data = new DataTransfer();
      const target = Array.from(document.querySelectorAll('thead th')).find((th) => th.textContent?.includes('Name'))!;
      const rect = target.getBoundingClientRect();
      const at = { clientX: rect.left + 4, clientY: rect.top + rect.height / 2, bubbles: true, cancelable: true, dataTransfer: data };
      button.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent('dragover', at));
      target.dispatchEvent(new DragEvent('drop', at));
      button.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    });
    await expect(headers).toHaveText(['Alpha', 'Name', 'Beta']);

    // Kept after a reload
    await page.waitForTimeout(500);
    await page.reload();
    await expect(headers).toHaveText(['Alpha', 'Name', 'Beta']);
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

  test('pauses editing while the table is connecting or reconnecting', async ({ alice: page, workspaceId }) => {
    // Hold back the live connection: each attempt is closed until allowed.
    let allowed = false;
    const sockets: { close: () => Promise<void> }[] = [];
    await page.routeWebSocket(/\/collab/, (ws) => {
      if (!allowed) {
        void ws.close();
        return;
      }
      ws.connectToServer();
      sockets.push(ws);
    });
    const id = await createPage(page, workspaceId, { title: unique('Offline table'), kind: 'DATABASE' });
    await page.goto(`/doc/${id}`);
    const notice = main(page).locator('.database-table__connection');
    const addRow = main(page).getByRole('button', { name: 'Add row' });
    await expect(notice).toContainText('Connecting…');
    await expect(addRow).toBeDisabled();

    allowed = true;
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(addRow).toBeEnabled();
    const before = await rowNames(page).count();
    await addRow.click();
    await expect(rowNames(page)).toHaveCount(before + 1);

    // Losing the connection later pauses editing again, until it's back.
    allowed = false;
    await Promise.all(sockets.splice(0).map((ws) => ws.close()));
    await expect(notice).toContainText('Reconnecting…');
    await expect(addRow).toBeDisabled();
    allowed = true;
    await expect(notice).toHaveCount(0, { timeout: 15_000 });
    await expect(addRow).toBeEnabled();
  });

  test("a view chosen on a database view block is only for you, until you save it for everyone", async ({ alice, bob, workspaceId }) => {
    // A database with an "Only Apple" view, embedded on a page
    const db = await createPage(alice, workspaceId, { title: unique('Fruit'), kind: 'DATABASE' });
    const nameField = (await (await alice.request.get(`/api/pages/${db}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    for (const fruit of ['Apple', 'Banana']) await alice.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [nameField]: fruit } } });
    await alice.request.post(`/api/pages/${db}/database/fields`, { data: { name: 'Notes', type: 'TEXT' } });
    const view = await (await alice.request.post(`/api/pages/${db}/database/views`, {
      data: { name: 'Only Apple', config: { filters: { match: 'AND', rules: [{ fieldId: nameField, operator: 'contains', value: 'Apple' }] } } },
    })).json();
    const doc = await createPage(alice, workspaceId, { title: unique('Report') });
    await openPage(alice, doc);
    await alice.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    await waitForSaved(alice);
    await openPage(bob, doc);

    const fruits = (page: Page) => page.locator('.ce-database-view tbody tr');
    const picker = (page: Page) => page.locator('.ce-database-view__view-select');
    const blockViewId = () => alice.evaluate(() => {
      const json = (document.querySelector('.ProseMirror') as any).editor.getJSON();
      return json.content.find((n: any) => n.type === 'databaseView')?.attrs?.viewId || null;
    });
    await expect(fruits(alice)).toHaveCount(2);
    await expect(fruits(bob)).toHaveCount(2);

    // Alice's choice changes only what she sees
    await picker(alice).selectOption({ label: 'Only Apple' });
    await expect(fruits(alice)).toHaveCount(1);
    await expect(alice.getByText('Only you see this')).toBeVisible();
    expect(await blockViewId()).toBeNull();
    await bob.waitForTimeout(500);
    await expect(fruits(bob)).toHaveCount(2);
    await expect(picker(bob)).toHaveValue('');

    // Remembered in her browser, and Reset goes back to the block's view
    await alice.reload();
    await expect(fruits(alice)).toHaveCount(1);
    await alice.getByRole('button', { name: 'Reset' }).click();
    await expect(fruits(alice)).toHaveCount(2);
    await expect(alice.getByText('Only you see this')).toHaveCount(0);

    // Hiding a column (on the block's own view) is hers alone too, until saved for everyone
    const notesHeader = (page: Page) => page.locator('.ce-database-view thead th', { hasText: 'Notes' });
    await expect(notesHeader(bob)).toHaveCount(1);
    await alice.locator('.ce-database-view').getByRole('button', { name: 'Columns' }).click();
    await alice.locator('.db-columns-menu__item', { hasText: 'Notes' }).click();
    await alice.keyboard.press('Escape');
    await alice.mouse.click(5, 5);
    await expect(notesHeader(alice)).toHaveCount(0);
    await expect(alice.getByText('Only you see this')).toBeVisible();
    await bob.waitForTimeout(500);
    await expect(notesHeader(bob)).toHaveCount(1);
    await alice.getByRole('button', { name: 'Save for everyone' }).click();
    await expect(alice.getByText('Only you see this')).toHaveCount(0);
    await expect(notesHeader(bob)).toHaveCount(0);

    // A view saved for everyone: Bob sees it too
    await picker(alice).selectOption({ label: 'Only Apple' });
    await alice.getByRole('button', { name: 'Save for everyone' }).click();
    await expect(alice.getByText('Only you see this')).toHaveCount(0);
    expect(await blockViewId()).toBe(view.id);
    await expect(picker(bob)).toHaveValue(view.id);
    await expect(fruits(bob)).toHaveCount(1);
  });

  test("a database view block's controls can be turned off, showing everyone the block's own view", async ({ alice: page, workspaceId }) => {
    const db = await createPage(page, workspaceId, { title: unique('Fruit'), kind: 'DATABASE' });
    const nameField = (await (await page.request.get(`/api/pages/${db}/database`)).json()).fields.find((f: any) => f.name === 'Name').id;
    for (const fruit of ['Apple', 'Banana']) await page.request.post(`/api/pages/${db}/database/rows`, { data: { data: { [nameField]: fruit } } });
    await page.request.post(`/api/pages/${db}/database/views`, {
      data: { name: 'Only Apple', config: { filters: { match: 'AND', rules: [{ fieldId: nameField, operator: 'contains', value: 'Apple' }] } } },
    });
    const doc = await createPage(page, workspaceId, { title: unique('Report') });
    await openPage(page, doc);
    await page.evaluate((pageId) => {
      (document.querySelector('.ProseMirror') as any).editor.chain().focus('end').insertContent({ type: 'databaseView', attrs: { pageId } }).run();
    }, db);
    const block = page.locator('.ce-database-view');
    const fruits = block.locator('tbody .db-cell-input');
    await expect(fruits).toHaveCount(2);
    // A choice of her own first
    await block.locator('.ce-database-view__view-select').selectOption({ label: 'Only Apple' });
    await expect(fruits).toHaveCount(1);

    await block.hover();
    await page.locator('.drag-handle--floating:not(.drag-handle--list) .drag-handle__btn--drag').click();
    await page.locator('.block-menu').getByRole('button', { name: 'Show controls' }).click();
    // The picker, Columns and search go, and the block's own view shows, not her choice
    await expect(block.locator('.ce-database-view__header-controls')).toBeHidden();
    await expect(block.getByRole('button', { name: 'Columns' })).toBeHidden();
    await expect(fruits).toHaveCount(2);
    await waitForSaved(page);
    await page.reload();
    await expect(fruits).toHaveCount(2);
    await expect(block.locator('.ce-database-view__header-controls')).toBeHidden();
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
