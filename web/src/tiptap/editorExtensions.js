import { Extension, InputRule, textInputRule } from '@tiptap/core';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { RedoSelection } from './redoSelection';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import Color from '@tiptap/extension-color';
import { TextStyle } from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Typography from '@tiptap/extension-typography';
import { Markdown } from '@tiptap/markdown';
import { LinkEditorExtension } from './linkEditor';
import PageMention from './pageMention';
import { MarkdownLinks } from './markdownLinks';
import { inLinkAddress, inUnclosedCode, textBefore } from './typingContext';
// The marked version @tiptap/markdown is built for (18 trims the blank lines it reads as empty paragraphs)
import { Marked } from 'marked-tiptap';
import { all, createLowlight } from 'lowlight';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import lua from 'highlight.js/lib/languages/lua';
import CodeBlockWithLang from './codeBlock';
import PageLink from './pageLink';
import DatabaseView from './databaseView';
import DatabaseForm from './databaseForm';
import SlashCommand from './slashCommand';
import ResizableImage from './resizableImage';
import { ImageUploads } from './imageUploads';
import HorizontalRule from './horizontalRule';
import Callout from './callout';
import ImagePlaceholder from './imagePlaceholder';
import TableOfContents from './tableOfContents';
import ToggleHeading from './toggleHeading';
import Columns from './columns';
import Indent from './indent';
import Drawio from './drawio';
import GaussianSplat from './gaussianSplat';
import { AiSuggestionExtension } from './aiSuggestions';
import { createBlockIdExtension, createBlockPositionExtension } from './blockIds';
import { createBulletDepthPlugin } from './bulletDepth';
import { ListJoin } from './listJoin';
import { ColumnCleanupExtension, ColumnInputGuardExtension } from './columnGuards';
import { createInputSelectionGuardExtension } from './inputSelectionGuard';
import { KeyboardWayOut } from './keyboardWayOut';
import { createSyncedMirrorExtension } from './syncedBlocks';
import { codeBlockLanguages } from './editorMenuOptions';

const lowlight = createLowlight(all);
// register aliases so user-friendly names resolve
lowlight.register('html', xml);
lowlight.register('javascript', javascript);
lowlight.register('js', javascript);
lowlight.register('typescript', typescript);
lowlight.register('ts', typescript);
lowlight.register('json', json);
lowlight.register('bash', bash);
lowlight.register('markdown', markdown);
lowlight.register('python', python);
lowlight.register('lua', lua);

/**
 * The page editor's extensions.
 * - collab: { document, provider, user } for live editing (provider null until it's ready), or null.
 * - isCollabEnabled (ref), isSyncedLocked, hasWorkspaceSyncedReference: for block ids and synced blocks.
 * - pageLinks, pageMentions, databaseViews, slashCommands, links, markdownLinks: the options for those extensions.
 * - getPlaceholder: the page's own placeholder text, if any.
 * - lastTextInputAt, lastTextInputInfo: when and what was last typed (for the selection guard).
 * - lastPointerDownAt: when the editor was last clicked (a cursor move then is meant).
 * - dragBlock(event, { pos, node }): starts dragging a block, as its handle does (for images).
 */
// Typography rules don't apply while typing inline code (after a ` that hasn't been closed yet on
// the line, until the closing ` makes it code; in code already, Tiptap skips them), or a Markdown
// link's address ("[spec](example.com/rfc--draft)": "--" made it "—", and the link went nowhere)
const outsideInlineCode = (rule) =>
  new InputRule({
    find: rule.find,
    undoable: rule.undoable,
    handler: (props) => {
      const before = textBefore(props.state.doc.resolve(props.range.from));
      if (inUnclosedCode(before) || inLinkAddress(before)) return null;
      return rule.handler(props);
    },
  });

export function createEditorExtensions({
  collab,
  isCollabEnabled,
  isSyncedLocked,
  hasWorkspaceSyncedReference,
  pageLinks,
  pageMentions,
  databaseViews,
  slashCommands,
  links,
  markdownLinks,
  getPlaceholder,
  lastTextInputAt,
  lastTextInputInfo,
  lastPointerDownAt,
  dragBlock,
  focusTitle,
  openBlockMenu,
  closeMenus,
}) {
  return [
      ...(collab
        ? [
            Collaboration.configure({
              document: collab.document,
            }),
            RedoSelection,
            ...(collab.provider
              ? [
                  CollaborationCaret.configure({
                    provider: collab.provider,
                    user: collab.user,
                    render: (user) => {
                      const caret = document.createElement('span');
                      const color = user?.color || '#f97316';
                      caret.classList.add('collaboration-carets__caret');
                      caret.style.setProperty('--caret-color', color);
                      caret.style.color = color;
                      const label = document.createElement('div');
                      label.classList.add('collaboration-carets__label');
                      label.style.backgroundColor = color;
                      label.textContent = user?.name || 'User';
                      caret.appendChild(label);
                      return caret;
                    },
                  }),
                ]
              : []),
          ]
        : []),
      createBlockIdExtension({ isCollabEnabled }),
      createSyncedMirrorExtension({ isSyncedLocked }),
      createBlockPositionExtension({ hasWorkspaceSyncedReference }),
      ColumnCleanupExtension,
      Indent,
      Color.configure({ types: ['textStyle'] }),
      TextStyle,
      StarterKit.configure({
        // Use Yjs undo manager when collaboration is enabled.
        undoRedo: collab ? false : undefined,
        link: false,
        codeBlock: false,
        horizontalRule: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        bulletList: { keepMarks: true, keepAttributes: true },
        orderedList: { keepMarks: true, keepAttributes: true },
      }),
      HorizontalRule,
      Columns,
      Table.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            fullWidth: {
              default: false,
              parseHTML: el => el.getAttribute('data-full-width') === 'true',
              renderHTML: attrs => attrs.fullWidth ? { 'data-full-width': 'true' } : {},
            },
          };
        },
      }).configure({
        resizable: true,
        // Let the block handle select the whole table (as one block), so moving or deleting it
        // takes the table itself, not just what's in its cells
        allowTableNodeSelection: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockWithLang.configure({
        lowlight,
        languages: codeBlockLanguages,
      }),
      Highlight.configure({ multicolor: true }),
      TaskList.configure({
        HTMLAttributes: { class: 'tiptap-task-list' },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: { class: 'tiptap-task-item' },
      }),
      ListJoin,
      ImagePlaceholder,
      // Reads Markdown into the page (pasting it) with each extension's own Markdown rules. Its own
      // marked: on the shared one each editor added its rules for good, which kept every editor
      // ever opened in memory (and made each paste run all their rules)
      Markdown.configure({ marked: new Marked() }),
      // A link is the words it was given: typing at its end isn't part of it (with autolink on, Tiptap
      // has it take in what's typed there; the word after a link joined it)
      Link.extend({ inclusive: () => false }).configure({
        autolink: true,
        linkOnPaste: true,
        // (A click is LinkEditorExtension's: a page here opens in place)
        openOnClick: false,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer' },
      }),
      ResizableImage.configure({
        inline: false,
        dragBlock,
      }),
      ImageUploads,
      Placeholder.configure({
        showOnlyCurrent: true,
        showOnlyWhenEditable: true,
        placeholder: ({ editor: ed }) => {
          const placeholder = getPlaceholder();
          if (placeholder && ed?.isEmpty) return placeholder;
          return "Start writing, type '/' to add a block";
        },
      }),
      TableOfContents,
      ToggleHeading,
      Callout,
      PageLink.configure(pageLinks),
      PageMention.configure(pageMentions),
      LinkEditorExtension.configure(links),
      MarkdownLinks.configure(markdownLinks),
      DatabaseView.configure(databaseViews),
      DatabaseForm.configure({
        listDatabasePages: databaseViews.listDatabasePages,
      }),
      Drawio,
      GaussianSplat,
      Typography.extend({
        addInputRules() {
          return [
            ...this.parent(),
            textInputRule({ find: /~=$/, replace: '≈' }),
            // (c), (r), (tm) and (sm) as words of their own, not the end of one ("f(c)")
            textInputRule({ find: /(?:^|[\s([{"'])(\(c\))$/, replace: '©' }),
            textInputRule({ find: /(?:^|[\s([{"'])(\(r\))$/, replace: '®' }),
            textInputRule({ find: /(?:^|[\s([{"'])(\(tm\))$/, replace: '™' }),
            textInputRule({ find: /(?:^|[\s([{"'])(\(sm\))$/, replace: '℠' }),
            // "3 x 4" (spaced), not sizes and names such as 3x4 or 1920x1080
            textInputRule({ find: /\d\s([x*])\s\d$/, replace: '×' }),
          ].map(outsideInlineCode);
        },
      }).configure({
        openDoubleQuote: false,
        closeDoubleQuote: false,
        openSingleQuote: false,
        closeSingleQuote: false,
        copyright: false,
        registeredTrademark: false,
        trademark: false,
        servicemark: false,
        multiplication: false,
      }),
      SlashCommand.configure(slashCommands),
      ColumnInputGuardExtension,
      createInputSelectionGuardExtension({ lastTextInputAt, lastTextInputInfo, lastPointerDownAt }),
      AiSuggestionExtension,
      Extension.create({ name: 'bullet-depth', addProseMirrorPlugins: () => [createBulletDepthPlugin()] }),
      KeyboardWayOut.configure({ focusTitle, openBlockMenu, closeMenus }),
  ];
}
