import { Extension, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { pageLinkTarget } from '../utils/editorLinks';

// Links: Ctrl/⌘+K opens the link editor (LinkEditor.vue, opened by the editor through `open`) with
// words chosen or the cursor in a link; otherwise it's left to the app's search. A click on a link
// opens it: a link to a page here in Wikid opens that page in place (`openPage`), any other in a
// new tab.

// A transaction with this as meta works the locks out again (a page made private or shared, or
// the page list loaded: the editor sends one)
export const privateLinksKey = new PluginKey('private-page-links');

export const LinkEditorExtension = Extension.create({
  name: 'linkEditor',
  addOptions() {
    // isPrivatePage(id), othersCanRead(): for the lock on words linked to a private page, on a page
    // others can read (they can't open it)
    return { open: null, openPage: null, isPrivatePage: null, othersCanRead: null };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        if (!this.editor.isEditable || typeof this.options.open !== 'function') return false;
        const { selection, schema } = this.editor.state;
        const inLink = schema.marks.link && getMarkRange(selection.$from, schema.marks.link);
        // (A page mention next to the cursor counts as a link: ⌘K edits it)
        const atMention = [selection.$from.nodeBefore, selection.$from.nodeAfter].some((node) => node?.type.name === 'pageMention');
        if (selection.empty && !inLink && !atMention) return false;
        this.options.open();
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    // Words linked to a private page: marked (a lock after them, see style.css) while others can
    // read this page. Worked out again only when the page changes.
    const privateLinks = (doc) => {
      if (!options.othersCanRead?.() || typeof options.isPrivatePage !== 'function') return DecorationSet.empty;
      const decorations = [];
      doc.descendants((node, pos) => {
        if (!node.isText) return;
        const link = node.marks.find((mark) => mark.type.name === 'link');
        const target = link && pageLinkTarget(link.attrs.href);
        if (target && options.isPrivatePage(target.pageId)) {
          decorations.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'page-link--private', title: 'Only you can open this page; others see “Private page”' }));
        }
      });
      return DecorationSet.create(doc, decorations);
    };

    return [
      new Plugin({
        key: privateLinksKey,
        state: {
          init: (_config, state) => privateLinks(state.doc),
          apply: (tr, value, _old, state) => (tr.docChanged || tr.getMeta(privateLinksKey) ? privateLinks(state.doc) : value),
        },
        props: {
          decorations: (state) => privateLinksKey.getState(state),
        },
      }),
      new Plugin({
        key: new PluginKey('link-click'),
        props: {
          handleClick(view, _pos, event) {
            // (Shift-click extends the selection, over a link too)
            if (event.button !== 0 || event.shiftKey) return false;
            const anchor = event.target?.closest?.('a[href]');
            if (!anchor || !view.dom.contains(anchor)) return false;
            const href = anchor.getAttribute('href');
            const target = pageLinkTarget(href);
            if (target && typeof options.openPage === 'function' && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              options.openPage(target.pageId, target.hash);
              return true;
            }
            event.preventDefault();
            window.open(anchor.href, '_blank', 'noopener,noreferrer');
            return true;
          },
        },
      }),
    ];
  },
});
