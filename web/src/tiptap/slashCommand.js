import { Extension } from '@tiptap/core';
import Suggestion, { SuggestionPluginKey } from '@tiptap/suggestion';
import { VueRenderer } from '@tiptap/vue-3';
import tippy from 'tippy.js';
import SlashCommandList from './SlashCommandList.vue';

// One slash menu on screen at a time. While a new page's first editor hands over to the live one,
// both can briefly have the menu open (each editor has its own); the newer one wins.
let closeOpenMenu = null;

export default Extension.create({
  name: 'slash-command',
  addOptions() {
    return {
      commands: [],
      suggestion: {
        char: '/',
        startOfLine: false,
      },
      onOpen: () => {},
      onClose: () => {},
    };
  },
  addProseMirrorPlugins() {
    const extension = this;
    // The items a search matches: all of them (it showed only the first 10), the menu scrolling. A
    // search of several words ("table of", "2 col") matches the start of a title or keyword, and
    // starts right after the "/": in "1 / 2" or "either / or" the menu stays shut
    // (the text match is kept for the next call with the same search; what's available is asked each
    // time, as it depends on where the "/" is, in a table say)
    let last = { query: null, items: [] };
    const matching = (query) => {
      if (query !== last.query) {
        const q = query.toLowerCase();
        let items = [];
        if (!/\s/.test(q)) {
          items = extension.options.commands.filter((item) => item.title.toLowerCase().includes(q) || item.search?.some((t) => t.includes(q)));
        } else if (!/^\s/.test(q)) {
          const words = q.replace(/\s+$/, '');
          items = extension.options.commands.filter((item) => item.title.toLowerCase().startsWith(words) || item.search?.some((t) => t.startsWith(words)));
        }
        last = { query, items };
      }
      return last.items.filter((item) => !item.isAvailable || item.isAvailable());
    };
    const triggerLength = (this.options.suggestion.char || '/').length;
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        // A search can have spaces ("table of contents", "2 columns"; a space ended it), while it
        // still matches something (see matching): a sentence after a "/" closes the menu
        allowSpaces: true,
        allow: ({ state, range }) => {
          const query = state.doc.textBetween(range.from, range.to, ' ').slice(triggerLength);
          return !/\s/.test(query) || matching(query).length > 0;
        },
        items: ({ query }) => matching(query),
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: () => {
          let component;
          let popup;

          const close = () => {
            if (closeOpenMenu === close) closeOpenMenu = null;
            extension.options.onClose?.();
            if (popup?.[0] && !popup[0].state?.isDestroyed) {
              popup[0].destroy();
            }
            component?.destroy();
            component = null;
            popup = null;
          };
          const stillTyping = (editor) => !editor.isDestroyed && !!SuggestionPluginKey.getState(editor.state)?.active;

          // Below the "/" if the menu fits there, or there's more room there than above; otherwise
          // above (near the bottom of the window it ran off-screen). Its height fits that side.
          const MAX_HEIGHT = 360;
          const fit = (props) => {
            const rect = props.clientRect?.();
            const el = component?.element;
            if (!rect || !el) return 'bottom-start';
            const below = window.innerHeight - rect.bottom - 16;
            const above = rect.top - 16;
            const wanted = Math.min(MAX_HEIGHT, el.scrollHeight || MAX_HEIGHT);
            const placeBelow = below >= wanted || below >= above;
            el.style.maxHeight = `${Math.max(120, Math.min(MAX_HEIGHT, placeBelow ? below : above))}px`;
            return placeBelow ? 'bottom-start' : 'top-start';
          };

          const start = (props) => {
            if (closeOpenMenu && closeOpenMenu !== close) closeOpenMenu();
            closeOpenMenu = close;
            extension.options.onOpen?.();
            component = new VueRenderer(SlashCommandList, {
              editor: props.editor,
              props,
            });

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
              animation: 'shift-away-subtle',
              theme: 'light-border',
              popperOptions: {
                // The side is chosen here (fit), not flipped by popper
                modifiers: [{ name: 'flip', enabled: false }],
              },
            });
            popup?.[0]?.setProps({ placement: fit(props) });
          };

          return {
            onStart: start,
            onUpdate(props) {
              // No menu, though one's being typed (see onExit): open it
              if (!component) {
                start(props);
                return;
              }
              component.updateProps(props);
              if (popup?.[0]?.setProps) {
                popup[0].setProps({
                  getReferenceClientRect: props.clientRect,
                  placement: fit(props),
                });
              }
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup?.[0]?.hide?.();
                extension.options.onClose?.();
                return true;
              }
              return component?.ref?.onKeyDown(props) ?? false;
            },
            // The suggestion's view is rebuilt when the editor's plugins change (as when a new page's
            // live editor takes over and sets up), and that exits the menu though "/" is still being
            // typed; the new view then only sends updates. So an exit while it's still active waits a
            // moment, and closes only if the editor's gone or the "/" is.
            onExit(props) {
              const editor = props?.editor;
              if (editor && stillTyping(editor)) {
                setTimeout(() => {
                  if (!stillTyping(editor)) close();
                }, 0);
                return;
              }
              close();
            },
          };
        },
      }),
    ];
  },
});
