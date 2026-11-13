import { Extension } from '@tiptap/core';
import { NodeSelection, Selection } from 'prosemirror-state';

// Ways in and out of the editor from the keyboard. Ctrl/Cmd+/ opens the block menu for the block the
// cursor is in (it could only be opened with the mouse). Escape leaves the editor (Tab indents in it, so Tab alone
// never got out): after it the next Tab goes on to what comes next. ArrowUp on the first line goes to
// the page's title (there was no way up to it). Both come last, after anything else using the key
// (the slash menu, a link being edited).
export const KeyboardWayOut = Extension.create({
  name: 'keyboardWayOut',
  priority: 1,
  addOptions() {
    return { focusTitle: null, openBlockMenu: null, closeMenus: null };
  },
  addKeyboardShortcuts() {
    return {
      'Mod-/': () => this.options.openBlockMenu?.() === true,
      // First whatever's open over the page (the block menu, the code language picker), then out of
      // the page. Not marked as handled when leaving, so a dialog the page is in still sees it.
      Escape: ({ editor }) => {
        if (this.options.closeMenus?.()) return true;
        editor.view.dom.blur();
        return false;
      },
      ArrowUp: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!this.options.focusTitle) return false;
        // The first block selected (a picture, a divider): up again goes to the title
        if (selection instanceof NodeSelection && selection.from === 0) return this.options.focusTitle() === true;
        if (!selection.empty) return false;
        // On the first line of the page's first line of text
        const first = Selection.atStart(state.doc);
        if (selection.$from.parent !== first.$from.parent || !view.endOfTextblock('up')) return false;
        return this.options.focusTitle() === true;
      },
    };
  },
});
