import Image, { inputRegex as imageInputRegex } from '@tiptap/extension-image';
import { InputRule } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ResizableImage from './ResizableImage.vue';

// An image address that only lasts as long as the tab it came from (Safari pastes images as
// blob: ones), or that's on the copier's own computer: never saved, as no one could load it later
export const isLocalImageSrc = (src) => /^(blob|file|webkit-fake-url):/i.test(String(src || '').trim());

const ResizableImageExtension = Image.extend({
  // Keep the same name as the base Image node so existing JSON/doc content still matches.
  name: 'image',

  addOptions() {
    return {
      ...this.parent?.(),
      // Starts dragging the image's block, as the block handle does
      dragBlock: null,
    };
  },

  // "![alt](address)" typed: the image, made as Tiptap's own rule makes it, then the cursor on the
  // line after it (a new one if the image is last). Left to itself, the cursor had nowhere in the text
  // to go and the image was selected (since Tiptap 3.33), so the next key typed replaced it.
  addInputRules() {
    return [
      new InputRule({
        find: imageInputRegex,
        handler: ({ state, range, match }) => {
          const [, whole, alt, src, title] = match;
          const { tr } = state;
          const image = this.type.create({ src, alt, title });
          let start = range.from + match[0].lastIndexOf(whole);
          let end = range.to;
          if (start > end) start = end;
          else end = start + whole.length;
          // (The last character typed isn't in the document yet)
          if (range.to - range.from < match[0].length) tr.insertText(match[0][match[0].length - 1], range.from + match[0].length - 1);
          tr.replaceWith(start, end, image);
          // Where it went: a block, so the line it was typed in may have been split round it (just
          // round where it was put, not the whole page)
          let after = null;
          const near = tr.mapping.map(start, -1);
          tr.doc.nodesBetween(Math.max(0, near - 2), Math.min(tr.doc.content.size, near + 2), (node, pos) => {
            if (after === null && node === image) after = pos + node.nodeSize;
            return after === null;
          });
          if (after !== null) {
            const next = tr.doc.resolve(after).nodeAfter;
            if (next) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(after), 1));
            } else {
              // Last on the page: a line after it to type on (as there'd be anyway once it's in)
              tr.insert(after, state.schema.nodes.paragraph.create());
              tr.setSelection(TextSelection.create(tr.doc, after + 1));
            }
          }
          tr.scrollIntoView();
        },
      }),
    ];
  },

  parseHTML() {
    return [{
      tag: this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])',
      getAttrs: (element) => (isLocalImageSrc(element.getAttribute('src')) ? false : null),
    }];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute('width') || element.style.width || null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { width: attributes.width, style: `width: ${attributes.width}` };
        },
      },
      // The image's own size in pixels, recorded when it's added, so its space can be kept while it loads
      naturalWidth: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-natural-width')) || null,
        renderHTML: (attributes) => (attributes.naturalWidth ? { 'data-natural-width': attributes.naturalWidth } : {}),
      },
      naturalHeight: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-natural-height')) || null,
        renderHTML: (attributes) => (attributes.naturalHeight ? { 'data-natural-height': attributes.naturalHeight } : {}),
      },
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(ResizableImage);
  },
});

export default ResizableImageExtension;
