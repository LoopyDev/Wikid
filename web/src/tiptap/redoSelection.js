import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from 'prosemirror-state';
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';

// After a redo, the cursor goes to the end of what came back. y-tiptap put it where it was when the
// change was undone, in text the undo had taken away, which ends up somewhere else (the start of the
// line put back, an empty line further down, above a divider), so the next key landed there.

const key = new PluginKey('redoSelection');

export const RedoSelection = Extension.create({
  name: 'redoSelection',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        // Where the last undo or redo changed the page, from its first change to its last (kept in
        // place through the changes that follow it), and a count of the undos and redos the editor has
        // had, to tell when the next one arrives
        state: {
          init: () => ({ seen: 0, changed: null }),
          apply(tr, value, oldState, newState) {
            if (!tr.docChanged) return value;
            if (!tr.getMeta(ySyncPluginKey)?.isUndoRedoOperation) {
              return value.changed ? { ...value, changed: { from: tr.mapping.map(value.changed.from, -1), to: tr.mapping.map(value.changed.to, 1) } } : value;
            }
            const start = newState.doc.content.findDiffStart(oldState.doc.content);
            const end = newState.doc.content.findDiffEnd(oldState.doc.content);
            return { seen: value.seen + 1, changed: start == null || !end ? null : { from: start, to: Math.max(start, end.a) } };
          },
        },
        view(view) {
          const undoManager = yUndoPluginKey.getState(view.state)?.undoManager;
          let lastSeen = key.getState(view.state).seen;
          let arrived = false; // an undo or redo reached the editor, and Yjs hasn't said which yet
          let waitingFor = null; // what Yjs said, while its change is still on its way
          const placeCursor = () => {
            if (view.isDestroyed) return;
            const { changed } = key.getState(view.state);
            if (!changed) return;
            const { doc } = view.state;
            const to = Math.min(changed.to, doc.content.size);
            // The end of the last line it changed; or, if it changed no line (a divider), the line after
            const back = Selection.findFrom(doc.resolve(to), -1, true);
            const selection = back && back.from >= changed.from ? back : Selection.findFrom(doc.resolve(to), 1, true) ?? back;
            if (!selection || selection.eq(view.state.selection)) return;
            view.dispatch(view.state.tr.setSelection(selection).setMeta('addToHistory', false).scrollIntoView());
          };
          // Yjs says it was a redo once its own change is done. Usually the editor has it by then; but
          // y-tiptap runs undo and redo inside a larger change (to put moved lines back), and then Yjs
          // says so first, and the editor gets the change before that larger change ends
          const onPopped = ({ type }) => {
            if (view.isDestroyed) return;
            if (undoManager.doc._transaction) {
              arrived = false;
              waitingFor = type;
              // It arrives before this code runs on; if it didn't (it changed nothing here), forget it
              queueMicrotask(() => { waitingFor = null; });
              return;
            }
            const came = arrived;
            arrived = false;
            if (type === 'redo' && came) placeCursor();
          };
          undoManager?.on('stack-item-popped', onPopped);
          return {
            update: () => {
              const { seen } = key.getState(view.state);
              if (seen === lastSeen) return;
              lastSeen = seen;
              if (waitingFor) {
                if (waitingFor === 'redo') queueMicrotask(placeCursor);
                waitingFor = null;
                return;
              }
              arrived = true;
              queueMicrotask(() => { arrived = false; });
            },
            destroy: () => undoManager?.off('stack-item-popped', onPopped),
          };
        },
      }),
    ];
  },
});
