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
    };
  },

  addNodeView() {
    return VueNodeViewRenderer(ResizableImage);
  },
});

export default ResizableImageExtension;
