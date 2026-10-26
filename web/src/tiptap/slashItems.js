import { createDatabaseViewConfig } from './blockPayloads';
import { normalizeLinkHref } from '../utils/editorLinks';

// The slash menu's items: each has a title, search keywords, an icon and the command it runs.
export function createSlashItems({ insertToggleHeading, insertColumns, insertImageFromUpload, props, getResolvedPage, workspace, showAiPrompt }) {
  return [
    { title: 'Text', icon: 'Tx', hint: 'Paragraph', search: ['text', 'paragraph', 'p'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setParagraph().run() },
    { title: 'Heading 1', icon: 'H1', hint: 'Big heading', search: ['h1', 'heading'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run() },
    { title: 'Heading 2', icon: 'H2', hint: 'Section heading', search: ['h2', 'heading'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run() },
    { title: 'Heading 3', icon: 'H3', hint: 'Sub heading', search: ['h3', 'heading'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run() },
    { title: 'Toggle heading 1', icon: 'T1', hint: 'Collapsible heading', search: ['toggle', 'heading', 'collapse'], command: ({ editor, range }) => insertToggleHeading(editor, range, 1) },
    { title: 'Toggle heading 2', icon: 'T2', hint: 'Collapsible heading', search: ['toggle', 'heading', 'collapse'], command: ({ editor, range }) => insertToggleHeading(editor, range, 2) },
    { title: 'Toggle heading 3', icon: 'T3', hint: 'Collapsible heading', search: ['toggle', 'heading', 'collapse'], command: ({ editor, range }) => insertToggleHeading(editor, range, 3) },
    { title: 'Code block', icon: '</>', hint: 'Monospace block', search: ['code', 'snippet'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run() },
    { title: 'To-do list', icon: '[ ]', hint: 'Task list', search: ['todo', 'task', 'checkbox'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run() },
    { title: 'Bulleted list', icon: '*', hint: 'Bullet points', search: ['bullet', 'ul', 'list'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run() },
    { title: 'Numbered list', icon: '1.', hint: 'Ordered list', search: ['number', 'ol', 'list'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run() },
    { title: 'Divider', icon: '---', hint: 'Horizontal rule', search: ['divider', 'hr', 'rule'], command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setHorizontalRule().run() },
    {
      title: 'Table of contents',
      icon: 'toc',
      hint: 'Outline headings on this page',
      search: ['toc', 'table of contents', 'outline', 'contents'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent({ type: 'tableOfContents' }).run();
      },
    },
    {
      title: 'Callout',
      icon: '💡',
      hint: 'Highlighted note',
      search: ['callout', 'note', 'info', 'hint'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({ type: 'callout', attrs: { icon: '💡' }, content: [{ type: 'paragraph', content: [] }] })
          .run();
      },
    },
    {
      title: '2 columns',
      icon: '2c',
      hint: 'Two column layout',
      search: ['columns', 'two', 'layout', '2 columns'],
      command: ({ editor, range }) => insertColumns(editor, range, 2),
    },
    {
      title: '3 columns',
      icon: '3c',
      hint: 'Three column layout',
      search: ['columns', 'three', 'layout', '3 columns'],
      command: ({ editor, range }) => insertColumns(editor, range, 3),
    },
    {
      title: '4 columns',
      icon: '4c',
      hint: 'Four column layout',
      search: ['columns', 'four', 'layout', '4 columns'],
      command: ({ editor, range }) => insertColumns(editor, range, 4),
    },
    {
      title: 'Table',
      icon: 'tbl',
      hint: 'Insert table',
      search: ['table', 'grid', 'rows', 'columns'],
      command: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      title: 'Database view',
      icon: 'db',
      hint: 'Embed a table view',
      search: ['database', 'table', 'view', 'db'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'databaseView',
            attrs: { pageId: '', title: '', icon: '', view: createDatabaseViewConfig() },
          })
          .run();
      },
    },
    {
      title: 'Form',
      icon: 'fm',
      hint: 'Embed a form',
      search: ['form', 'database form', 'embed form'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: 'databaseForm',
            attrs: { formId: '', name: '', databasePageId: '' },
          })
          .run();
      },
    },
    {
      title: 'Diagram',
      icon: '⬡',
      hint: 'draw.io diagram',
      search: ['diagram', 'drawio', 'draw', 'chart', 'flow', 'flowchart'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent({ type: 'drawio', attrs: { xml: '', svg: '' } }).run();
      },
    },
    {
      title: '3D Splat',
      icon: '◎',
      hint: '3D Gaussian splat viewer',
      search: ['3d', 'splat', 'gaussian', 'spz', '3dgs', 'point cloud'],
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).insertContent({ type: 'gaussianSplat', attrs: { src: '' } }).run();
      },
    },
    {
      title: 'Link',
      icon: 'lnk',
      hint: 'Add a link',
      search: ['link', 'url'],
      command: ({ editor, range }) => {
        const url = window.prompt('Enter a URL');
        if (url === null) return;
        const href = normalizeLinkHref(url);
        if (!href) return;
        const label = url.trim();
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setLink({ href, target: '_blank' })
          .insertContent(label)
          .run();
      },
    },
    {
      title: 'Image',
      icon: 'img',
      hint: 'Upload an image',
      search: ['image', 'img', 'picture', 'photo'],
      command: ({ editor, range }) => {
        insertImageFromUpload(editor, range);
      },
    },
    {
      title: 'Page link',
      icon: 'pg',
      hint: 'Link another page',
      search: ['page', 'link', 'subpage'],
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({ type: 'pageLink', attrs: { pageId: '', title: '', icon: '' } })
          .run();
      },
    },
    {
      title: 'Add page',
      icon: '+pg',
      hint: 'Create a sub-page',
      search: ['page', 'new', 'sub', 'subpage', 'child', 'add page', 'create page'],
      command: ({ editor, range }) => {
        // Delete the slash trigger immediately so the menu closes cleanly
        editor.chain().focus().deleteRange(range).run();
        // Create the child page async, then insert the link
        (async () => {
          const parentPage = props.pageId ? getResolvedPage(props.pageId) : workspace.currentPage;
          if (!parentPage) return;
          const newPage = await workspace.createChildPageRecord(parentPage);
          if (!newPage) return;
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'pageLink',
              attrs: { pageId: newPage.id, title: newPage.title || 'Untitled page', icon: newPage.icon || '' },
            })
            .run();
        })();
      },
    },
    {
      title: 'AI Writer',
      icon: '✦',
      isAvailable: () => workspace.aiEnabled,
      hint: 'Write with AI',
      search: ['ai', 'write', 'generate', 'claude', 'gpt', 'assistant'],
      command: ({ editor, range }) => {
        showAiPrompt(range, editor);
      },
    },
  ];
}
