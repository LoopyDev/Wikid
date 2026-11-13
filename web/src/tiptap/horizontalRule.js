import { Node, mergeAttributes, nodeInputRule } from '@tiptap/core';

// *** and ___ only with a space after, so ***bold italic*** can be typed. "—-" is "---" after the
// typing shortcut has made the first two dashes an em dash (it gave "—-", not a divider)
const setHorizontalRuleInput = /^(?:---|—-|___\s|\*\*\*\s)$/;

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

  // Markdown's --- (pasted, or from the page's Markdown): it was dropped, having nothing to become
  markdownTokenName: 'hr',
  parseMarkdown: (_token, helpers) => helpers.createNode('horizontalRule'),
  renderMarkdown: () => '---',

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
