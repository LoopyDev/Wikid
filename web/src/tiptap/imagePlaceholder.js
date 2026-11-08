import { Node, mergeAttributes } from '@tiptap/core';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import ImagePlaceholderNode from './ImagePlaceholderNode.vue';

// A box saying which image goes here ("Upload a photo of the site"), with an Upload button that
// puts the image in its place. Templates use it instead of images, which belong to one workspace;
// it's in the / menu anywhere, for a draft too. The text is typed in the box like a paragraph's.
export default Node.create({
  name: 'imagePlaceholder',
  group: 'block',
  content: 'text*',
  marks: '',
  defining: true,
  addStorage() {
    // Set by the editor: uploads files to a position, resolving to how many went in
    return { upload: null };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="image-placeholder"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'image-placeholder' }), 0];
  },
  addKeyboardShortcuts() {
    return {
      // Enter carries on with a paragraph after it, rather than a second placeholder
      // (into an empty one already there, if there is one)
      Enter: ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== this.name) return false;
        const after = $from.after();
        const next = editor.state.doc.nodeAt(after);
        if (next?.type.name === 'paragraph' && next.content.size === 0) return editor.chain().setTextSelection(after + 1).run();
        return editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).run();
      },
    };
  },
  addNodeView() {
    return VueNodeViewRenderer(ImagePlaceholderNode);
  },
});
