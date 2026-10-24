import { Extension } from '@tiptap/core';

const INDENT_TYPES = ['paragraph', 'heading'];
const MAX_INDENT = 50;

const clampIndent = (value) => {
  const next = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(MAX_INDENT, next));
};

const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: INDENT_TYPES,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.getAttribute('data-indent');
              const value = raw ? Number.parseInt(raw, 10) : 0;
              return clampIndent(value);
            },
            renderHTML: (attributes) => {
              const indent = clampIndent(attributes.indent);
              if (!indent) return {};
              return {
                'data-indent': indent,
                style: `--indent-level: ${indent};`,
              };
            },
          },
        },
      },
    ];
  },
});

export { MAX_INDENT, INDENT_TYPES, clampIndent };
export default Indent;
