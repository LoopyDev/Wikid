import type { Page } from '@playwright/test';
import { test, expect, createPage, unique } from './fixtures';
import { main, openViewOptions } from './database-helpers';

// A board view: a card dragged to another column (or moved with its "Move to" list, by keyboard or
// on a phone) takes that column's choice.

/** A database with a Status select, rows in it, and a board grouped by Status; opened on the board. */
async function boardWith(page: Page, workspaceId: string, rows: Array<[string, string | null]>, { hide }: { hide?: string } = {}) {
  const id = await createPage(page, workspaceId, { kind: 'DATABASE', title: unique('Tasks') });
  const db = await (await page.request.get(`/api/pages/${id}/database`)).json();
  const name = db.fields.find((f: any) => f.name === 'Name').id;
  const status = (
    await (await page.request.post(`/api/pages/${id}/database/fields`, { data: { name: 'Status', type: 'SELECT', options: { choices: ['To do', 'Doing', 'Done'] } } })).json()
  ).id as string;
  for (const [title, value] of rows) {
    await page.request.post(`/api/pages/${id}/database/rows`, { data: { data: { [name]: title, ...(value ? { [status]: value } : {}) } } });
  }
  // A filter hiding the rows with this choice
  const filters = hide ? { match: 'AND', rules: [{ fieldId: status, operator: 'is_not', value: hide }] } : undefined;
  expect((await page.request.post(`/api/pages/${id}/database/views`, { data: { name: 'Board', type: 'BOARD', config: { groupFieldId: status, ...(filters ? { filters } : {}) } } })).status()).toBe(201);
  await page.goto(`/doc/${id}`);
  await main(page).getByRole('button', { name: 'Board' }).click();
  const statusOf = async (title: string) => {
    const { rows: all } = await (await page.request.get(`/api/pages/${id}/database`)).json();
    return all.find((row: any) => row.data[name] === title)?.data[status] ?? null;
  };
  return { id, statusOf };
}

const column = (page: Page, label: string) => main(page).locator('.db-board__column').filter({ has: page.locator('.db-board__column-title', { hasText: new RegExp(`^${label}$`) }) });
const card = (page: Page, title: string) =>
  main(page).locator('.db-board__card-wrap').filter({ has: page.locator('.db-board__card-title', { hasText: new RegExp(`^${title}$`) }) });

test.describe('board view', () => {
  // Wide enough for the whole board: a drag scrolls a board that runs off the side under the pointer
  test.use({ viewport: { width: 1600, height: 900 } });

  test('its settings are in a View options menu, as a gallery\'s are', async ({ alice: page, workspaceId }) => {
    const { id } = await boardWith(page, workspaceId, [['Write', 'To do']]);
    const groupBy = main(page).getByLabel('Group by');
    // Which fields its cards show is in there too, not a Columns button beside it
    await expect(main(page).getByRole('button', { name: 'Columns' })).toHaveCount(0);
    // Out of the way until asked for
    await expect(groupBy).toBeHidden();
    await expect(main(page).getByLabel('Colour cards by')).toBeHidden();
    await openViewOptions(page);
    await expect(groupBy).toBeVisible();
    await expect(main(page).getByLabel('Colour cards by')).toBeVisible();
    await expect(main(page).getByLabel('Colour style')).toBeVisible();
    const statusOnCard = main(page).locator('.db-board__card-field', { hasText: 'To do' });
    await expect(statusOnCard).toHaveCount(1);
    await main(page).locator('.db-view-options .db-card-fields__option', { hasText: 'Status' }).locator('input').uncheck();
    await expect(statusOnCard).toHaveCount(0);
    // ...and they work from there
    await groupBy.selectOption('None');
    await expect(column(page, 'To do')).toHaveCount(0);
    const view = async () => (await (await page.request.get(`/api/pages/${id}/database`)).json()).views[0];
    await expect.poll(async () => (await view()).config.groupFieldId ?? null).toBe(null);
  });

  test('a long board scrolls as one, in the window: its column headers stay in sight, and its sideways scrollbar too', async ({ alice: page, workspaceId }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const rows = (count: number, status: string) => Array.from({ length: count }, (_, i) => [`${status} ${i + 1}`, status] as [string, string]);
    // A long column, a short one, and one between (longer than the box, shorter than the longest)
    await boardWith(page, workspaceId, [...rows(40, 'To do'), ...rows(2, 'Doing'), ...rows(14, 'Done')]);
    const box = main(page).locator('.db-board__columns');
    await expect(column(page, 'To do').locator('.db-board__card-title')).toHaveCount(40);
    // No taller than the window, so its bottom (and the sideways scrollbar there) can be in sight
    const { height } = (await box.boundingBox())!;
    expect(height).toBeLessThanOrEqual(720);
    expect(await box.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    // Scrolled down inside it, the columns' headers stay at its top
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const header = column(page, 'To do').locator('.db-board__column-header');
    await expect.poll(async () => Math.round((await header.boundingBox())!.y - (await box.boundingBox())!.y)).toBeLessThanOrEqual(1);
    // A short column's too (each column as tall as the longest)...
    const shortHeader = column(page, 'Doing').locator('.db-board__column-header');
    await expect.poll(async () => Math.round((await shortHeader.boundingBox())!.y - (await box.boundingBox())!.y)).toBeLessThanOrEqual(1);
    // ...and its cards stay under it, not scrolled away
    const below = async (title: string) => {
      const b = (await box.boundingBox())!;
      const c = (await card(page, title).boundingBox())!;
      return { top: c.y - b.y, bottom: b.y + b.height - (c.y + c.height) };
    };
    await expect.poll(async () => (await below('Doing 1')).top).toBeGreaterThan(0);
    expect((await below('Doing 1')).top).toBeLessThan(100);
    // A column longer than the box, though shorter than the longest: its last card, whole, at the bottom
    await expect.poll(async () => Math.round((await below('Done 14')).bottom)).toBeGreaterThanOrEqual(0);
    expect((await below('Done 14')).bottom).toBeLessThan(40);
    await expect(card(page, 'Done 14')).toBeInViewport({ ratio: 1 });
    // ...over the cards, not see-through
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('a card dragged to another column takes its choice; to "No value", none', async ({ alice: page, workspaceId }) => {
    const { statusOf } = await boardWith(page, workspaceId, [['Write', 'To do'], ['Test', 'To do']]);
    await expect(column(page, 'To do').locator('.db-board__card-title')).toHaveText(['Write', 'Test']);

    await card(page, 'Write').locator('.db-board__card').dragTo(column(page, 'Done'));
    await expect(column(page, 'Done').locator('.db-board__card-title')).toHaveText(['Write']);
    await expect(column(page, 'To do').locator('.db-board__card-title')).toHaveText(['Test']);
    await expect.poll(() => statusOf('Write')).toBe('Done');

    await card(page, 'Write').locator('.db-board__card').dragTo(column(page, 'No value'));
    await expect(column(page, 'No value').locator('.db-board__card-title')).toHaveText(['Write']);
    await expect.poll(() => statusOf('Write')).toBe(null);
  });

  test('a card moves with its "Move to" list too, by keyboard', async ({ alice: page, workspaceId }) => {
    const { statusOf } = await boardWith(page, workspaceId, [['Write', 'To do']]);
    const moveTo = card(page, 'Write').getByRole('combobox', { name: 'Move “Write” to' });
    await moveTo.focus();
    await moveTo.selectOption('Doing');
    await expect(column(page, 'Doing').locator('.db-board__card-title')).toHaveText(['Write']);
    await expect.poll(() => statusOf('Write')).toBe('Doing');
    // The keyboard goes on from the card's list in its new column
    await expect(card(page, 'Write').getByRole('combobox')).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(card(page, 'Write').getByRole('button')).toBeFocused();
  });

  test("moved to a column the view's filter hides, it says so, and Undo puts it back", async ({ alice: page, workspaceId }) => {
    const { statusOf } = await boardWith(page, workspaceId, [['Write', 'To do']], { hide: 'Done' });
    await card(page, 'Write').locator('.db-board__card').dragTo(column(page, 'Done'));
    const notice = main(page).getByRole('status').filter({ hasText: '“Write” moved to Done' });
    await expect(notice).toContainText("this view doesn't show it");
    await expect.poll(() => statusOf('Write')).toBe('Done');
    await expect(card(page, 'Write')).toHaveCount(0);

    await notice.getByRole('button', { name: 'Undo' }).click();
    await expect(column(page, 'To do').locator('.db-board__card-title')).toHaveText(['Write']);
    await expect.poll(() => statusOf('Write')).toBe('To do');
    await expect(notice).toHaveCount(0);
  });
});
