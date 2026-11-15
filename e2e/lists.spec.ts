import { expect } from '@playwright/test';
import { test, createPage, openPage, editor } from './fixtures';

// A list's items sit closer together than paragraphs do: 6px between items (a nested list, and
// the next block in an item, too), where paragraphs keep 12px; a list keeps 12px under it. Items used to take a paragraph's
// whole space each, spreading every list out.
test('list items are 6px apart, paragraphs 12px; to-do lists and nested lists alike', async ({ alice: page, workspaceId }) => {
  const id = await createPage(page, workspaceId);
  const markdown = [
    'First paragraph', '', 'Second paragraph', '',
    '- One', '- Two', '  - Two a', '  - Two b', '- Three', '  > A quote in an item', '- Four', '',
    '1. First', '2. Second', '',
    '- [ ] Post the letter', '  - [ ] Buy a stamp', '- [x] Book the dentist', '',
    'After',
  ].join('\n');
  expect((await page.request.put(`/api/pages/${id}/markdown`, { data: { markdown } })).status()).toBe(200);
  await openPage(page, id);
  await expect(editor(page).locator('li')).toHaveCount(11);
  // The space from the bottom of one block's text (a paragraph, or an item's own line) to the top
  // of the next (a paragraph, or the next item)
  const between = (a: string, b: string) =>
    page.evaluate(([x, y]) => {
      const paragraphs = [...document.querySelectorAll('.ProseMirror:not(.page-hold *) p')] as HTMLElement[];
      const p = (text: string) => paragraphs.find((el) => el.textContent?.trim() === text)!;
      const above = p(x);
      // The next block: an item (from its li), or a paragraph
      const next = p(y);
      const below = next.closest('li') && next.closest('li') !== above.closest('li') ? next.closest('li')! : next;
      return Math.round(below.getBoundingClientRect().top - above.getBoundingClientRect().bottom);
    }, [a, b]);
  expect(await between('First paragraph', 'Second paragraph')).toBe(12);
  expect(await between('One', 'Two')).toBe(6);
  // A nested list starts 6px under its item's text, and its items are 6px apart
  expect(await between('Two', 'Two a')).toBe(6);
  expect(await between('Two a', 'Two b')).toBe(6);
  // ...and the next item is 6px under the nested list
  expect(await between('Two b', 'Three')).toBe(6);
  expect(await between('First', 'Second')).toBe(6);
  // A to-do item's nested list too, and the next to-do under it
  expect(await between('Post the letter', 'Buy a stamp')).toBe(6);
  expect(await between('Buy a stamp', 'Book the dentist')).toBe(6);
  // A list keeps a paragraph's 12px under it
  expect(await between('Book the dentist', 'After')).toBe(12);
  // A quote in an item: 6px under the item's text, and the next item 6px under it
  const quoteGaps = await page.evaluate(() => {
    const quote = document.querySelector('.ProseMirror:not(.page-hold *) li blockquote') as HTMLElement;
    const item = quote.closest('li')!;
    const text = item.querySelector(':scope > p') as HTMLElement;
    const next = item.nextElementSibling as HTMLElement;
    const q = quote.getBoundingClientRect();
    return [Math.round(q.top - text.getBoundingClientRect().bottom), Math.round(next.getBoundingClientRect().top - q.bottom)];
  });
  expect(quoteGaps).toEqual([6, 6]);
});
