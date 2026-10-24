import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import CodeBlockView from './CodeBlockView.vue';

const DEFAULT_LANGUAGES = ['', 'javascript', 'typescript', 'json', 'html', 'css', 'bash', 'markdown', 'python'];

const CodeBlockWithLang = CodeBlockLowlight.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      languages: DEFAULT_LANGUAGES,
    };
  },
  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView);
  },
  addKeyboardShortcuts() {
    const base = this.parent?.();
    return {
      ...base,
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (selection instanceof NodeSelection && selection.node.type?.name === this.name) {
          const pos = selection.from + 1;
          editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos)));
          return true;
        }
        return base?.Backspace ? base.Backspace({ editor }) : false;
      },
    };
  },
});

export default CodeBlockWithLang;
