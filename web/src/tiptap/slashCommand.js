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
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }) => {
          const q = query.toLowerCase();
          return extension.options.commands
            .filter((item) => !item.isAvailable || item.isAvailable())
            .filter((item) => item.title.toLowerCase().includes(q) || item.search?.some((t) => t.includes(q)))
            .slice(0, 10);
        },
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
                modifiers: [
                  // Keep the menu anchored below the cursor instead of
                  // flipping above it; height is capped by the list itself.
                  { name: 'flip', enabled: false },
                ],
              },
            });
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
