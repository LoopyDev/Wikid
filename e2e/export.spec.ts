import { expect } from '@playwright/test';
import { test, createPage, unique } from './fixtures';

// Pages exported to a single HTML file.

test.describe('export', () => {
  test('a short page exported one page at a time keeps its sub-page links at the bottom of the screen', async ({ alice: page, workspaceId }) => {
    const parent = await createPage(page, workspaceId, { title: unique('Short parent') });
    const childTitle = unique('Child');
    await createPage(page, workspaceId, { title: childTitle, parentId: parent });
    const res = await page.request.post('/api/export/html', { data: { rootPageId: parent, mode: 'pages' } });
    expect(res.ok()).toBe(true);

    await page.setViewportSize({ width: 1200, height: 800 });
    await page.setContent(await res.text());
    const links = page.locator(`#page-${parent} .child-pages`);
    await expect(links).toContainText(childTitle);
    const box = await links.boundingBox();
    // Under the page's bottom padding, not straight after its title
    expect(box!.y + box!.height).toBeGreaterThan(800 - 100);
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  });
});
