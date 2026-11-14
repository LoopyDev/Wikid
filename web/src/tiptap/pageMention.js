import { InputRule, Node, mergeAttributes } from '@tiptap/core';
import { PluginKey } from 'prosemirror-state';
import Suggestion from '@tiptap/suggestion';
import { VueNodeViewRenderer, VueRenderer } from '@tiptap/vue-3';
import tippy from 'tippy.js';
import PageMentionView from './PageMentionView.vue';
import PageMentionList from './PageMentionList.vue';
import { mentionLabel } from './pageMentionLabel';

// Page mentions: a page named in a line of text, shown with its icon and title as they are now
// (PageMentionView.vue). It holds only the page's id: the title is looked up for whoever reads it,
// so someone else's private page shows as a private page, and a renamed page by its new name.
// Put in by typing "@" or "[[" and choosing a page, by typing "[[" a page's exact title "]]", or
// from the link editor. As Markdown, "[@Title](/doc/<id>)" (the server reads that back as one).
//
// Options: resolvePage(id) gives the page ({ title, icon, isDeleted }) if this person can see it,
// listPages() the pages one can be made of, openPage(id) opens one.

const MAX_RESULTS = 8;


const matchingPages = (options, query) => {
  const q = query.trim().toLowerCase();
  return (options.listPages?.() || [])
    .filter((page) => !q || (page.title || 'Untitled page').toLowerCase().includes(q))
    .slice(0, MAX_RESULTS);
};

// The list under the "@" or "[[" while a page is being searched for
const mentionSuggestion = (extension, char, key) =>
  Suggestion({
    editor: extension.editor,
    char,
    pluginKey: new PluginKey(key),
    // A title can have spaces ("Onboarding guide"); a blank line's worth ends it
    allowSpaces: true,
    // Not in code, or in the middle of a word (an email address has an "@")
    allowedPrefixes: [' ', '(', ' '],
    items: ({ query }) => matchingPages(extension.options, query),
    command: ({ editor, range, props: page }) => {
      editor
        .chain()
        .focus()
        .insertContentAt(range, [{ type: 'pageMention', attrs: { pageId: page.id } }, { type: 'text', text: ' ' }])
        .run();
    },
    allow: ({ state, range }) => {
      const $from = state.doc.resolve(range.from);
      if ($from.parent.type.spec.code || $from.marks().some((mark) => mark.type.name === 'code')) return false;
      // A search with spaces in it ("Onboarding guide") only while it still matches a page: in
      // "meet @ 5pm in the hall" the list goes once nothing does
      const query = state.doc.textBetween(range.from, range.to, ' ').slice(char.length);
      return !/\s/.test(query) || matchingPages(extension.options, query).length > 0;
    },
    render: () => {
      let component;
      let popup;
      // Escape: the list goes, and the keys are the page's again (Enter a new line, not a page)
      let dismissed = false;
      return {
        onStart: (props) => {
          dismissed = false;
          component = new VueRenderer(PageMentionList, { editor: props.editor, props });
          if (!props.clientRect) return;
          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          });
        },
        onUpdate: (props) => {
          component?.updateProps(props);
          if (props.clientRect) popup?.[0]?.setProps({ getReferenceClientRect: props.clientRect });
        },
        onKeyDown: (props) => {
          if (dismissed) return false;
          if (props.event.key === 'Escape') {
            dismissed = true;
            popup?.[0]?.hide();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.[0]?.destroy();
          component?.destroy();
          popup = null;
          component = null;
        },
      };
    },
  });

export default Node.create({
  name: 'pageMention',
  group: 'inline',
  inline: true,
  atom: true,
  // (The arrow keys go past it, not onto it: typing then replaced it)
  selectable: false,
  addOptions() {
    return { resolvePage: null, listPages: null, openPage: null };
  },
  addAttributes() {
    return {
      pageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-page-id') || '',
        renderHTML: (attrs) => ({ 'data-page-id': attrs.pageId }),
      },
    };
  },
  parseHTML() {
    // (Before the link's own rule for an <a>: a pasted mention came back as linked words)
    return [{ tag: 'a[data-type="page-mention"]', priority: 100 }];
  },
  // (Copied out of the editor: a link to the page, with its title as it is now)
  renderHTML({ node, HTMLAttributes }) {
    const label = mentionLabel(this.options.resolvePage?.(node.attrs.pageId));
    return ['a', mergeAttributes(HTMLAttributes, { 'data-type': 'page-mention', href: `/doc/${node.attrs.pageId}` }), `@${label}`];
  },
  renderText({ node }) {
    return `@${mentionLabel(this.options.resolvePage?.(node.attrs.pageId))}`;
  },
  addNodeView() {
    return VueNodeViewRenderer(PageMentionView, { as: 'span' });
  },
  addInputRules() {
    const options = this.options;
    return [
      // "[[" a page's exact title "]]" typed out: a mention of it, if just one page has that title
      new InputRule({
        find: /\[\[([^[\]]+)\]\]$/,
        handler: ({ state, range, match }) => {
          const title = match[1].trim().toLowerCase();
          const found = (options.listPages?.() || []).filter((page) => (page.title || '').trim().toLowerCase() === title);
          if (found.length !== 1) return null;
          state.tr.replaceWith(range.from, range.to, state.schema.nodes.pageMention.create({ pageId: found[0].id }));
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    return [mentionSuggestion(this, '@', 'page-mention-at'), mentionSuggestion(this, '[[', 'page-mention-brackets')];
  },
});
