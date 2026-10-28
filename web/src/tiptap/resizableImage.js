import Image from '@tiptap/extension-image';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ResizableImage from './ResizableImage.vue';

const ResizableImageExtension = Image.extend({
  // Keep the same name as the base Image node so existing JSON/doc content still matches.
  name: 'image',

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
