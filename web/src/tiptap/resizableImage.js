import Image from '@tiptap/extension-image';
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
