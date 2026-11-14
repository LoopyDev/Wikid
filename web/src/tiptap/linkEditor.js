import { Extension, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { pageLinkTarget } from '../utils/editorLinks';

// Links: Ctrl/⌘+K opens the link editor (LinkEditor.vue, opened by the editor through `open`) with
// words chosen or the cursor in a link; otherwise it's left to the app's search. A click on a link
// opens it: a link to a page here in Wikid opens that page in place (`openPage`), any other in a
// new tab.

export const LinkEditorExtension = Extension.create({
  name: 'linkEditor',
  addOptions() {
    return { open: null, openPage: null };
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
    return [
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
