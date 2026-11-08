import { describe, expect, it } from 'vitest';
import { markdownToContent } from '../src/pages/markdown/markdown-to-content.util';
import {
  BlockOperationError,
  contentToMarkdown,
  deleteBlock,
  insertBlocks,
  markdownKeeps,
  markdownUnits,
  replaceAll,
  updateBlock,
} from '../src/pages/markdown/content-to-markdown.util';

const text = (value: string, ...marks: string[]) => (marks.length ? { type: 'text', text: value, marks: marks.map((type) => ({ type })) } : { type: 'text', text: value });
const p = (id: string | null, ...content: any[]) => ({ type: 'paragraph', ...(id ? { attrs: { id } } : {}), ...(content.length ? { content } : {}) });

describe('Markdown into page content', () => {
  it('makes headings, paragraphs with marks, and links', () => {
    expect(markdownToContent('# Plans\n\nSome **bold**, *italic*, ~~gone~~, `code` and [a link](https://example.com).')).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [text('Plans')] },
      p(null, text('Some '), text('bold', 'bold'), text(', '), text('italic', 'italic'), text(', '), text('gone', 'strike'), text(', '), text('code', 'code'), text(' and '), { type: 'text', text: 'a link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }, text('.')),
    ]);
  });

  it('makes bulleted, numbered and to-do lists, nested', () => {
    const [bullets, numbers, todos] = markdownToContent('- one\n  - inner\n- two\n\n1. first\n2. second\n\n- [ ] open\n- [x] done');
    expect(bullets).toEqual({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(null, text('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(null, text('inner'))] }] }] },
        { type: 'listItem', content: [p(null, text('two'))] },
      ],
    });
    expect(numbers.type).toBe('orderedList');
    expect(todos).toEqual({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: false }, content: [p(null, text('open'))] },
        { type: 'taskItem', attrs: { checked: true }, content: [p(null, text('done'))] },
      ],
    });
  });

  it('makes code blocks with their language, tables, dividers and images', () => {
    const blocks = markdownToContent('```ts\nconst a = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n---\n\nBefore ![A cat](cat.png) after');
    expect(blocks[0]).toEqual({ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] });
    expect(blocks[1].type).toBe('table');
    expect(blocks[1].content?.[0].content?.[0]).toEqual({ type: 'tableHeader', content: [p(null, text('A'))] });
    expect(blocks[2]).toEqual({ type: 'horizontalRule' });
    // An image in a paragraph is a block of its own
    expect(blocks.slice(3)).toEqual([p(null, text('Before')), { type: 'image', attrs: { src: 'cat.png', alt: 'A cat', title: null } }, p(null, text('after'))]);
  });

  it('makes a quote starting with an emoji a callout, as the export writes one', () => {
    expect(markdownToContent('> 💡 Remember this\n>\n> And this')).toEqual([
      { type: 'callout', attrs: { icon: '💡' }, content: [p(null, text('Remember this')), p(null, text('And this'))] },
    ]);
    expect(markdownToContent('> Just a quote')).toEqual([{ type: 'blockquote', content: [p(null, text('Just a quote'))] }]);
  });
});

describe('page content as Markdown', () => {
  it('reads back as the same content', () => {
    const markdown = [
      '# Plans',
      'Some **bold** and *italic* with a [link](https://example.com) and `code`.',
      '- one\n  - inner\n- two',
      '1. first\n2. second',
      '- [ ] open\n- [x] done',
      '```ts\nconst a = 1;\n```',
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
      '---',
      '![A cat](cat.png)',
      '> 💡 Remember this',
    ].join('\n\n');
    const content = markdownToContent(markdown) as any[];
    expect(contentToMarkdown(content)).toBe(markdown);
    expect(markdownKeeps(content)).toBe(true);
  });

  it('keeps text that looks like Markdown as text', () => {
    const content = [p('b1', text('# not a heading, *not* italic'))];
    expect(markdownKeeps(content as any)).toBe(true);
  });

  it("knows what Markdown can't hold", () => {
    expect(markdownKeeps([{ type: 'image', attrs: { src: 'cat.png', width: 320 } }])).toBe(false);
    expect(markdownKeeps([p(null, { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] })] as any)).toBe(false);
    expect(markdownKeeps([{ type: 'columns', content: [{ type: 'column', content: [p(null, text('a'))] }] }] as any)).toBe(false);
    expect(markdownKeeps([{ type: 'databaseView', attrs: { pageId: 'x', title: 'Stock' } }])).toBe(false);
    // Settings left at nothing don't count
    expect(markdownKeeps([{ type: 'paragraph', attrs: { id: 'b1', indent: 0, syncedFrom: null }, content: [text('plain')] }])).toBe(true);
  });
});

const page = (): any[] => [
  { type: 'heading', attrs: { id: 'h', level: 1 }, content: [text('Title')] },
  {
    type: 'columns',
    content: [
      { type: 'column', content: [p('left', text('Left side'))] },
      { type: 'column', content: [p('right', text('Right side')), { type: 'image', attrs: { id: 'img', src: 'a.png', width: 200 } }] },
    ],
  },
  { type: 'callout', attrs: { id: 'c', icon: '💡' }, content: [p('tip', text('A tip'))] },
  { type: 'databaseView', attrs: { id: 'db', pageId: 'x', title: 'Stock' } },
];

describe('the page as units', () => {
  it('opens up columns and callouts, and marks what Markdown can and can’t hold', () => {
    expect(markdownUnits(page() as any).map(({ id, markdown, parentId, column, embed, exact }) => ({ id, markdown, parentId, column, embed, exact }))).toEqual([
      { id: 'h', markdown: '# Title', parentId: null, column: null, embed: false, exact: true },
      { id: 'left', markdown: 'Left side', parentId: null, column: 1, embed: false, exact: true },
      { id: 'right', markdown: 'Right side', parentId: null, column: 2, embed: false, exact: true },
      { id: 'img', markdown: '![](a.png)', parentId: null, column: 2, embed: false, exact: false },
      { id: 'tip', markdown: 'A tip', parentId: 'c', column: null, embed: false, exact: true },
      { id: 'db', markdown: '[Database view: Stock]', parentId: null, column: null, embed: true, exact: false },
    ]);
  });
});

describe('changing blocks', () => {
  it('rewrites one block in a column, leaving the columns and the rest as they are', () => {
    const next = updateBlock(page() as any, 'right', 'Right side, **edited**') as any[];
    expect(next[1].content[1].content[0]).toEqual({ type: 'paragraph', attrs: { id: 'right' }, content: [text('Right side, '), text('edited', 'bold')] });
    expect(next[1].content[1].content[1]).toEqual(page()[1].content![1].content![1]);
    expect(next[3]).toEqual(page()[3]);
  });

  it('inserts after or before a block, or at the end', () => {
    expect((insertBlocks(page() as any, 'New', { afterId: 'tip' }) as any[])[2].content.map((b: any) => b.content?.[0]?.text)).toEqual(['A tip', 'New']);
    expect((insertBlocks(page() as any, 'First', { beforeId: 'h' }) as any[])[0]).toEqual(p(null, text('First')));
    expect((insertBlocks(page() as any, 'Last') as any[]).at(-1)).toEqual(p(null, text('Last')));
  });

  it('deletes a block, leaving an empty paragraph where a callout would be emptied', () => {
    const next = deleteBlock(page() as any, 'tip') as any[];
    expect(next[2].content).toEqual([{ type: 'paragraph' }]);
    expect((deleteBlock(page() as any, 'db') as any[]).length).toBe(3);
  });

  it("won't rewrite a database view, or a list item on its own", () => {
    expect(() => updateBlock(page() as any, 'db', 'text')).toThrow(BlockOperationError);
    const list = [{ type: 'bulletList', attrs: { id: 'l' }, content: [{ type: 'listItem', attrs: { id: 'li' }, content: [p('lp', text('a'))] }] }];
    expect(() => updateBlock(list as any, 'li', 'b')).toThrow(/list items/);
    expect(() => updateBlock(page() as any, 'missing', 'b')).toThrow(/No block missing/);
  });

  it('replaces a whole page only when Markdown would lose nothing', () => {
    expect(() => replaceAll(page() as any, '# New')).toThrow(/block by block/);
    expect(replaceAll([p('b1', text('Plain'))] as any, '# New')).toEqual([{ type: 'heading', attrs: { level: 1 }, content: [text('New')] }]);
    expect(replaceAll([{ type: 'paragraph' }], 'Hello')).toEqual([p(null, text('Hello'))]);
  });
});
