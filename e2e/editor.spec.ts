import { test, expect, createPage, openPage, editor, outline, pastePlainText, waitForSaved } from './fixtures';

test.describe('editor', () => {
  test('saves what you type, including markdown shortcuts', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('# Plans', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('Some text', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('- one', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('two', { delay: 20 });

    const expected = ['heading1: Plans', 'paragraph: Some text', 'bulletList', '  listItem', '    paragraph: one', '  listItem', '    paragraph: two'];
    await expect.poll(() => outline(page)).toEqual(expected);

    await waitForSaved(page);
    await openPage(page, id);
    await expect.poll(() => outline(page)).toEqual(expected);
  });

  test('turns pasted markdown into blocks', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await pastePlainText(page, '## Shopping\n\n- milk\n- `$&` bread\n\n```js\nconst a = 1;\n```');

    await expect.poll(() => outline(page)).toEqual([
      'heading2: Shopping',
      'bulletList',
      '  listItem',
      '    paragraph: milk',
      '  listItem',
      '    paragraph: $& bread',
      'codeBlock: const a = 1;',
    ]);
  });

  test('indents a paragraph with Tab and outdents with Shift+Tab', async ({ alice: page, workspaceId }) => {
    const id = await createPage(page, workspaceId);
    await openPage(page, id);
    await editor(page).click();
    await page.keyboard.type('Indented', { delay: 20 });
    const indent = () => page.evaluate(() => (document.querySelector('.ProseMirror') as any).editor.getJSON().content[0].attrs?.indent ?? 0);

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect.poll(indent).toBe(2);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(indent).toBe(1);
  });
});
