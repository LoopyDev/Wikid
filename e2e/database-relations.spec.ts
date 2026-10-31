import { test, expect, createPage, unique } from './fixtures';
import { main, chooseRelation, addNamedRow, openViewOptions } from './database-helpers';

// Relations between databases: their settings, their values as pills, "Linked from" columns, and renames.

test.describe('database relations', () => {
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
    await openViewOptions(page);
    await main(page).getByLabel('Cover').selectOption({ label: tasksTitle });
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

  test("a relation shows the linked row's new name when it's renamed elsewhere", async ({ alice: page, workspaceId }) => {
    const projects = await createPage(page, workspaceId, { title: unique('Projects'), kind: 'DATABASE' });
    const tasks = await createPage(page, workspaceId, { title: unique('Tasks'), kind: 'DATABASE' });
    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, projects, 'Website');
    await page.goto(`/doc/${tasks}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, tasks, 'Write copy');
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await chooseRelation(page, 0, 'Website');
    const pill = main(page).locator('tbody tr').nth(0).locator('.db-relation-pill');
    await expect(pill).toHaveText('Website');

    // Renamed in another tab
    const other = await page.context().newPage();
    await other.goto(`/doc/${projects}`);
    const name = other.getByRole('main').locator('tbody .db-cell-input').first();
    await expect(name).toHaveValue('Website');
    await name.fill('Homepage');
    await name.press('Enter');

    // Here, without a reload, and after one
    await expect(pill).toHaveText('Homepage', { timeout: 20_000 });
    await other.close();
    await page.reload();
    await expect(main(page).locator('tbody tr').nth(0).locator('.db-relation-pill')).toHaveText('Homepage');
  });
  test("a row's own colour shows on the pills of relations linking to it", async ({ alice: page, workspaceId }) => {
    const zonesTitle = unique('Thematic zones');
    const zones = await createPage(page, workspaceId, { title: zonesTitle, kind: 'DATABASE' });
    const exhibits = await createPage(page, workspaceId, { title: unique('Exhibits'), kind: 'DATABASE' });
    await page.goto(`/doc/${zones}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, zones, 'Ancient Egypt');
    await addNamedRow(page, zones, 'Ocean Life');
    await page.goto(`/doc/${exhibits}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, exhibits, 'Mummy case');
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await chooseRelation(page, 0, 'Ancient Egypt');
    const pill = main(page).locator('tbody tr').nth(0).locator('.db-relation-pill');
    await expect(pill).toHaveText('Ancient Egypt');
    await expect(pill).toHaveCSS('background-color', 'rgba(148, 163, 184, 0.12)');

    // Ancient Egypt is orange, from its row menu
    await page.goto(`/doc/${zones}`);
    const egypt = main(page).locator('tbody tr').nth(0);
    await egypt.hover();
    await egypt.getByRole('button', { name: 'Row actions' }).click();
    await page.locator('.db-row-menu').getByRole('button', { name: 'Orange' }).click();
    await expect(egypt.locator('.db-row-color-dot')).toHaveCSS('background-color', 'rgb(249, 115, 22)');
    await expect(main(page).locator('tbody tr').nth(1).locator('.db-row-color-dot')).toHaveCount(0);

    // So its pill on the exhibit is orange, and still after a reload
    await page.waitForTimeout(800);
    await page.goto(`/doc/${exhibits}`);
    await expect(pill).toHaveCSS('background-color', 'rgba(249, 115, 22, 0.18)');
    // And in the relation's picker, its dot
    await main(page).locator('tbody tr').nth(0).locator('.db-relation-change').click();
    const option = page.locator('.db-multi-select-menu .db-multi-option', { hasText: 'Ancient Egypt' });
    await expect(option.locator('.db-option-color-dot')).toHaveCSS('background-color', 'rgb(249, 115, 22)');
    await page.keyboard.press('Escape');
    await page.mouse.click(900, 600);
    await page.reload();
    await expect(pill).toHaveCSS('background-color', 'rgba(249, 115, 22, 0.18)');

    // Cleared again with None, this time from a right-click on the row
    await page.goto(`/doc/${zones}`);
    await egypt.locator('td').last().click({ button: 'right' });
    await expect(page.locator('.db-row-menu').getByRole('button', { name: 'Orange' })).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.db-row-menu').getByRole('button', { name: 'No colour' }).click();
    await expect(egypt.locator('.db-row-color-dot')).toHaveCount(0);
  });

  test("closing a column's menu with Escape keeps its changes, like clicking away", async ({ alice: page, workspaceId }) => {
    const zones = await createPage(page, workspaceId, { title: unique('Zones'), kind: 'DATABASE' });
    const exhibitsTitle = unique('Exhibits');
    await createPage(page, workspaceId, { title: exhibitsTitle, kind: 'DATABASE' });
    const id = await createPage(page, workspaceId, { title: unique('Visits'), kind: 'DATABASE' });
    await page.request.post(`/api/pages/${id}/database/fields`, {
      data: { name: 'Place', type: 'RELATION', options: { relation: { pageId: zones, allowMultiple: false } } },
    });
    await page.goto(`/doc/${id}`);
    const menu = page.locator('.db-field-menu');
    const openPlace = async () => {
      await main(page).locator('thead th', { hasText: 'Place' }).locator('button').first().click();
      await menu.locator('.block-menu__item', { hasText: 'Relation' }).first().click();
    };
    const target = () => menu.locator('.db-relation-settings__field', { hasText: 'Target database' }).locator('select');

    await openPlace();
    await target().selectOption({ label: exhibitsTitle });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await openPlace();
    await expect(target().locator('option:checked')).toHaveText(exhibitsTitle);
    await page.keyboard.press('Escape');

    // Escape while typing a new name still puts the name back
    await main(page).locator('thead th', { hasText: 'Place' }).locator('button').first().click();
    await menu.locator('.db-add-column-input').fill('Somewhere');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(main(page).locator('thead th', { hasText: 'Place' })).toBeVisible();

    await page.reload();
    await openPlace();
    await expect(target().locator('option:checked')).toHaveText(exhibitsTitle);
  });

  test("a column is wide enough for its pills from the first load, unless it's been dragged narrower", async ({ alice: page, workspaceId }) => {
    const projects = await createPage(page, workspaceId, { title: unique('Projects'), kind: 'DATABASE' });
    const tasksTitle = unique('Tasks');
    const tasks = await createPage(page, workspaceId, { title: tasksTitle, kind: 'DATABASE' });
    const longName = 'Rewrite the whole home page';

    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, projects, longName);

    await page.goto(`/doc/${tasks}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await addNamedRow(page, tasks, longName);
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Relation' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await chooseRelation(page, 0, longName);
    await expect(main(page).locator('.db-relation-pill')).toHaveText(longName);

    await page.goto(`/doc/${projects}`);
    await expect(main(page).getByRole('button', { name: 'Add row' })).toBeVisible();
    await main(page).locator('thead th').last().locator('button').first().click();
    await page.locator('.db-add-column-menu .block-menu__item', { hasText: 'Linked from' }).click();
    await expect(main(page).locator('thead th')).toHaveCount(3);
    await expect(main(page).locator('.db-linked-pill')).toHaveText(longName);

    // How far a pill sticks out of its cell: nothing, once fitted
    const overflow = (pills: string) => main(page).evaluate((root, selector) => {
      const pill = root.querySelector(selector);
      const cell = pill?.closest('td');
      return pill && cell ? pill.getBoundingClientRect().right - cell.getBoundingClientRect().right : Infinity;
    }, pills);
    await page.reload();
    await expect(main(page).locator('.db-linked-pill')).toHaveText(longName);
    await expect.poll(() => overflow('.db-linked-pill')).toBeLessThanOrEqual(0);

    // Dragged narrower, it stays so when the linked rows load again
    const header = main(page).locator('thead th').nth(1);
    const before = (await header.boundingBox())!;
    await header.hover();
    const handle = (await header.locator('.db-resizer').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 100, handle.y + handle.height / 2, { steps: 5 });
    await page.mouse.up();
    const narrower = (await header.boundingBox())!.width;
    expect(narrower).toBeLessThan(before.width - 50);
    const reloaded = page.waitForResponse((res) => res.url().includes('/linked-rows'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await reloaded;
    await page.waitForTimeout(200);
    expect((await header.boundingBox())!.width).toBe(narrower);

    await page.goto(`/doc/${tasks}`);
    await expect(main(page).locator('.db-relation-pill')).toHaveText(longName);
    await expect.poll(() => overflow('.db-relation-pill')).toBeLessThanOrEqual(0);
  });
});
