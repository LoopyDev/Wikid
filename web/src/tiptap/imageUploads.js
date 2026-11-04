import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// Images on their way up: each shows where it'll go, with a preview and its progress, until it's
// uploaded and put in. Only the person uploading sees them, and they're never saved, so an upload
// that never finishes (a closed tab) leaves nothing behind in the page.

const key = new PluginKey('imageUploads');
let nextId = 0;
let pending = 0;

// Leaving the page loses uploads still going, so the browser asks first
const warnBeforeLeaving = (event) => {
  event.preventDefault();
  event.returnValue = '';
};

const placeholder = (previewUrl, size) => {
  const el = document.createElement('div');
  el.className = 'image-upload-pending';
  el.contentEditable = 'false';
  el.setAttribute('role', 'status');
  const img = document.createElement('img');
  img.src = previewUrl;
  img.alt = '';
  if (size) {
    img.width = size.width;
    img.height = size.height;
  }
  const bar = document.createElement('div');
  bar.className = 'image-upload-pending__bar';
  const fill = document.createElement('span');
  bar.append(fill);
  const label = document.createElement('span');
  label.className = 'image-upload-pending__label';
  el.append(img, bar, label);
  const setProgress = (fraction) => {
    const percent = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    fill.style.width = `${percent}%`;
    label.textContent = `Uploading image… ${percent}%`;
  };
  setProgress(0);
  return { el, setProgress };
};

export const ImageUploads = Extension.create({
  name: 'imageUploads',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const action = tr.getMeta(key);
            if (action?.add) {
              const { id, pos, el } = action.add;
              // Before whatever's typed at the same spot, which the image then goes before too
              next = next.add(tr.doc, [Decoration.widget(pos, el, { id, side: -1 })]);
            }
            if (action?.remove != null) {
              next = next.remove(next.find(undefined, undefined, (spec) => spec.id === action.remove));
            }
            return next;
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

/**
 * Shows an upload at `pos` while `upload(onProgress)` runs, and gives back its result with where
 * the placeholder is now (after anyone's edits meanwhile), or null where it's gone.
 */
export async function withUploadPlaceholder(editor, pos, file, size, upload) {
  const id = `upload-${(nextId += 1)}`;
  const previewUrl = URL.createObjectURL(file);
  const { el, setProgress } = placeholder(previewUrl, size);
  const at = Math.max(0, Math.min(pos, editor.state.doc.content.size));
  editor.view.dispatch(editor.state.tr.setMeta(key, { add: { id, pos: at, el } }));
  if ((pending += 1) === 1) window.addEventListener('beforeunload', warnBeforeLeaving);
  try {
    const result = await upload(setProgress);
    if (editor.isDestroyed) return { result, pos: null };
    const found = key.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id)[0];
    return { result, pos: found ? found.from : null };
  } finally {
    if ((pending -= 1) === 0) window.removeEventListener('beforeunload', warnBeforeLeaving);
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, { remove: id }));
    URL.revokeObjectURL(previewUrl);
  }
}
