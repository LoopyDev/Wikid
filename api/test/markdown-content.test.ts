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

describe('images where Markdown allows them but the editor holds them as blocks', () => {
  it('puts an image in a heading after it, and one in a table cell as a block in the cell', () => {
    const [heading, image] = markdownToContent('# Plans ![map](map.png)') as any[];
    expect(heading).toEqual({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Plans' }] });
    expect(image).toMatchObject({ type: 'image', attrs: { src: 'map.png', alt: 'map' } });
    expect((markdownToContent('# ![logo](l.png) Plans') as any[])[0].content).toEqual([{ type: 'text', text: 'Plans' }]);

    const [table] = markdownToContent('| A | B |\n| --- | --- |\n| Before ![dot](dot.png) | Text |') as any[];
    const cell = table.content[1].content[0];
    expect(cell.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      expect.objectContaining({ type: 'image', attrs: expect.objectContaining({ src: 'dot.png' }) }),
    ]);
    // And it reads back as it was written, image and all
    expect(contentToMarkdown([table])).toBe('| A | B |\n| --- | --- |\n| Before ![dot](dot.png) | Text |');
    expect(markdownKeeps([table])).toBe(true);
  });
});

describe('page content as Markdown', () => {
  it('writes a page for an export: sections flattened, page links and database views left to fill in', () => {
    const content = [
      { type: 'toggleHeading', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'More' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Hidden' }] }] },
      { type: 'pageLink', attrs: { pageId: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'Other page' } },
      { type: 'databaseView', attrs: { pageId: 'aaaaaaaa-0000-4000-8000-000000000002', title: 'Stock' } },
    ];
    expect(contentToMarkdown(content as any, { forExport: true })).toBe(
      '## More\n\nHidden\n\n[Other page](wikid-page:aaaaaaaa-0000-4000-8000-000000000001)\n\n{{wikid-database:aaaaaaaa-0000-4000-8000-000000000002}}',
    );
  });

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

  it("counts a space at the end of a paragraph (someone mid-typing) as nothing Markdown would lose", () => {
    const typing = [{ type: 'paragraph', content: [{ type: 'text', text: 'Half a sentence ' }] }];
    expect(markdownKeeps(typing as any)).toBe(true);
  });

  it("keeps an image's title and address whole, quotes, backslashes, spaces and brackets included", () => {
    const image = { type: 'image', attrs: { src: 'my files/cat (1).png', alt: 'A cat', title: 'Say \\"hi\\" \\' } };
    const markdown = contentToMarkdown([image]);
    expect(markdownToContent(markdown)).toEqual([image]);
  });

  it('keeps text that looks like Markdown as text', () => {
    const content = [p('b1', text('# not a heading, *not* italic'))];
    expect(markdownKeeps(content as any)).toBe(true);
  });

  it("knows what Markdown can't hold", () => {
    expect(markdownKeeps([{ type: 'image', attrs: { src: 'cat.png', width: 320 } }])).toBe(false);
    expect(markdownKeeps([p(null, { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] })] as any)).toBe(false);
    // Columns and toggles are kept, as sections; a column dragged to a width of its own isn't
    expect(markdownKeeps([{ type: 'columns', content: [{ type: 'column', content: [p(null, text('a'))] }, { type: 'column', content: [p(null, text('b'))] }] }] as any)).toBe(true);
    expect(markdownKeeps([{ type: 'columns', content: [{ type: 'column', attrs: { width: 30 }, content: [p(null, text('a'))] }] }] as any)).toBe(false);
    expect(markdownKeeps([{ type: 'databaseView', attrs: { pageId: 'x', title: 'Stock' } }])).toBe(false);
    // Settings left at nothing don't count
    expect(markdownKeeps([{ type: 'paragraph', attrs: { id: 'b1', indent: 0, syncedFrom: null }, content: [text('plain')] }])).toBe(true);
  });
});

describe('columns and toggles', () => {
  const columns = (...cols: any[][]) => ({ type: 'columns', content: cols.map((content) => ({ type: 'column', content })) });

  it('reads "::: columns" sections, a "::: column" before each after the first', () => {
    expect(markdownToContent('Intro\n\n::: columns\nLeft **side**\n\n![Cat](cat.png)\n::: column\n- one\n- two\n:::\n\nAfter')).toEqual([
      p(null, text('Intro')),
      columns(
        [p(null, text('Left '), text('side', 'bold')), { type: 'image', attrs: { src: 'cat.png', alt: 'Cat', title: null } }],
        [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(null, text('one'))] }, { type: 'listItem', content: [p(null, text('two'))] }] }],
      ),
      p(null, text('After')),
    ]);
  });

  it('reads "::: toggle" sections, with columns inside', () => {
    expect(markdownToContent('::: toggle\n## Details\n\n::: columns\nA\n::: column\nB\n:::\n:::')).toEqual([
      { type: 'toggleHeading', content: [{ type: 'heading', attrs: { level: 2 }, content: [text('Details')] }, columns([p(null, text('A'))], [p(null, text('B'))])] },
    ]);
  });

  it('leaves ":::" lines in code alone, and says what is wrong with a section', () => {
    expect(markdownToContent('```\n::: columns\n```')[0]).toEqual({ type: 'codeBlock', attrs: { language: null }, content: [text('::: columns')] });
    expect(() => markdownToContent('::: columns\nA')).toThrow(/isn't closed/);
    expect(() => markdownToContent('::: column\nA\n:::')).toThrow(/belongs inside/);
    expect(() => markdownToContent('::: columns\n::: columns\n:::\n:::')).toThrow(/inside columns/);
    expect(() => markdownToContent('A\n:::')).toThrow(/no "::: columns"/);
  });

  it('writes them back as sections, so they round-trip', () => {
    const markdown = '::: columns\nLeft\n\n::: column\nRight\n:::\n\n::: toggle\n## More\n\nHidden text\n:::';
    expect(contentToMarkdown(markdownToContent(markdown) as any[])).toBe(markdown);
    // Flattened, as in an export to other apps
    expect(contentToMarkdown(markdownToContent(markdown) as any[], {})).toBe('Left\n\nRight\n\n## More\n\nHidden text');
  });

  it('marks each block with its id for tools, inside columns too', () => {
    const content = [{ type: 'heading', attrs: { id: 'h', level: 1 }, content: [text('T')] }, { type: 'columns', content: [{ type: 'column', content: [p('l', text('L'))] }, { type: 'column', content: [{ type: 'databaseView', attrs: { id: 'db', title: 'Stock' } }] }] }];
    expect(contentToMarkdown(content as any, { sections: true, markers: true })).toBe(
      '<!-- h -->\n# T\n\n::: columns\n<!-- l -->\nL\n\n::: column\n<!-- db · no Markdown form: can be deleted, not rewritten -->\n[Database view: Stock]\n:::',
    );
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

  it('adds columns to the page, but not inside a column', () => {
    const next = insertBlocks(page() as any, '::: columns\nA\n::: column\nB\n:::') as any[];
    expect(next.at(-1).type).toBe('columns');
    expect(() => insertBlocks(page() as any, '::: columns\nA\n:::', { afterId: 'left' })).toThrow(/inside a column/);
    expect(() => updateBlock(page() as any, 'h', '::: columns\nA')).toThrow(/isn't closed/);
  });

  it('writes and reads an image placeholder as "[Image to add: …]"', () => {
    const content = [{ type: 'imagePlaceholder', attrs: { id: 'ph' }, content: [text('A photo of the site')] }];
    expect(markdownUnits(content as any)[0]).toMatchObject({ id: 'ph', markdown: '[Image to add: A photo of the site]', embed: false, exact: true });
    expect(markdownToContent('[Image to add: A photo of the site]\n\n[Image to add]')).toEqual([
      { type: 'imagePlaceholder', content: [text('A photo of the site')] },
      { type: 'imagePlaceholder' },
    ]);
    // A paragraph that only says it stays a paragraph
    const said = [p('s', text('[Image to add: not really]'))];
    expect(markdownToContent(contentToMarkdown(said as any))).toEqual([p(null, text('[Image to add: not really]'))]);
  });

  it("won't rewrite a database view, or a list item on its own", () => {
    expect(() => updateBlock(page() as any, 'db', 'text')).toThrow(BlockOperationError);
    const list = [{ type: 'bulletList', attrs: { id: 'l' }, content: [{ type: 'listItem', attrs: { id: 'li' }, content: [p('lp', text('a'))] }] }];
    expect(() => updateBlock(list as any, 'li', 'b')).toThrow(/list items/);
    expect(() => updateBlock(page() as any, 'missing', 'b')).toThrow(/No block missing/);
  });

  it('replaces a whole page only when Markdown would lose nothing', () => {
    // The image's set width and the database view would be lost
    expect(() => replaceAll(page() as any, '# New')).toThrow(/block by block/);
    expect(replaceAll([p('b1', text('Plain'))] as any, '# New')).toEqual([{ type: 'heading', attrs: { level: 1 }, content: [text('New')] }]);
    expect(replaceAll([{ type: 'paragraph' }], 'Hello')).toEqual([p(null, text('Hello'))]);
  });
});

describe('page mentions', () => {
  const id = 'ca27b9ee-36f3-4e5f-9cdd-aaf0e385f380';
  it('"[@Title](/doc/<id>)" reads as a mention of that page; other links stay links', () => {
    expect(markdownToContent(`See [@Onboarding](/doc/${id}).`)[0].content).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'pageMention', attrs: { pageId: id } },
      { type: 'text', text: '.' },
    ]);
    // Without the "@", or to another site: a link
    expect(markdownToContent(`[Onboarding](/doc/${id})`)[0].content?.[0]).toMatchObject({ type: 'text', marks: [{ type: 'link' }] });
    expect(markdownToContent('[@someone](https://example.com)')[0].content?.[0]).toMatchObject({ type: 'text', marks: [{ type: 'link' }] });
  });

  it('a mention given no title is written so it reads back as itself, so a page with one can be rewritten', () => {
    const page = [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }, { type: 'pageMention', attrs: { pageId: id } }] }];
    expect(contentToMarkdown(page)).toBe(`See [@page](/doc/${id})`);
    expect(markdownKeeps(page)).toBe(true);
  });

  it('a bold mention, and two side by side, read back as mentions', () => {
    const mention = { type: 'pageMention', attrs: { pageId: id, label: 'Onboarding', href: `/doc/${id}` } };
    const page = [{ type: 'paragraph', content: [{ ...mention, marks: [{ type: 'bold' }] }, mention] }];
    const markdown = contentToMarkdown(page);
    expect(markdown).toBe(`[@Onboarding](/doc/${id})[@Onboarding](/doc/${id})`);
    expect(markdownToContent(markdown)[0].content).toEqual([
      { type: 'pageMention', attrs: { pageId: id } },
      { type: 'pageMention', attrs: { pageId: id } },
    ]);
  });
});
