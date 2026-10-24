import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import { VueRenderer } from '@tiptap/vue-3';
import tippy from 'tippy.js';
import SlashCommandList from './SlashCommandList.vue';

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
            .filter((item) => item.title.toLowerCase().includes(q) || item.search?.some((t) => t.includes(q)))
            .slice(0, 10);
        },
        command: ({ editor, range, props }) => {
          props.command({ editor, range });
        },
        render: () => {
          let component;
          let popup;

          return {
            onStart: (props) => {
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
            },
            onUpdate(props) {
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
              return component.ref?.onKeyDown(props) ?? false;
            },
            onExit() {
              extension.options.onClose?.();
              if (popup?.[0] && !popup[0].state?.isDestroyed) {
                popup[0].destroy();
              }
              component?.destroy();
              popup = null;
            },
          };
        },
      }),
    ];
  },
});
