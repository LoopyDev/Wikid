import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';

const setHorizontalRuleInput = /^(?:---|___|\*\*\*)$/;

export default Node.create({
  name: 'horizontalRule',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-color') || null,
        renderHTML: (attrs) =>
          attrs.color
            ? {
                'data-color': attrs.color,
                style: `--hr-color: ${attrs.color};`,
              }
            : {},
      },
      size: {
        default: 'medium',
        parseHTML: (element) => element.getAttribute('data-size') || 'medium',
        renderHTML: (attrs) => ({
          'data-size': attrs.size || 'medium',
        }),
      },
      align: {
        default: 'middle',
        parseHTML: (element) => element.getAttribute('data-align') || 'middle',
        renderHTML: (attrs) => ({
          'data-align': attrs.align || 'middle',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'hr' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['hr', mergeAttributes(HTMLAttributes)];
  },

  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: setHorizontalRuleInput,
        type: this.type,
      }),
    ];
  },
});
