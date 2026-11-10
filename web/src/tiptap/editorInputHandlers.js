import { Selection } from 'prosemirror-state';
import { selectionSyncedReferenceId } from './syncedBlocks';
import { parseBlockUrl } from '../utils/editorLinks';
import { liftImagesForPaste, shouldHandleMarkdownPaste } from '../utils/markdownPaste';
import { describeUndoStacks, logUndoDebug, undoDebugEnabled } from '../utils/editorDebug';
import { INDENT_EXCLUDED_ANCESTORS, applyCodeBlockIndentation, collectIndentTargets, findIndentTarget, hasAncestorOfType } from './indentation';
import { MAX_INDENT as MAX_TEXT_INDENT } from './indent';
import { isLocalImageSrc } from './resizableImage';

const imageFiles = (dataTransfer) => Array.from(dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));

// The images a paste holds as blob: addresses, while this tab can still read them, as files
async function blobImageFiles(srcs) {
  const files = await Promise.all(srcs.map(async (src, i) => {
    try {
      const blob = await (await fetch(src)).blob();
      return blob.type.startsWith('image/') ? new File([blob], `pasted-${i + 1}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }) : null;
    } catch {
      return null;
    }
  }));
  return files.filter(Boolean);
}

// The page editor's input handling (Tiptap's editorProps): pasting (markdown, block links as
// synced blocks), typing, dropping, keys (Tab indent, undo in live editing, synced-block locks)
// and clicks below the last block.
export function createEditorProps({ lastTextInputAt, lastTextInputInfo, props, isCollabEnabled, isSyncedLocked, notifySyncedBlockLocked, insertSyncedBlockFromUrl, insertImageFiles, shouldInsertClickPlaceholder, insertClickPlaceholder, dragScroll, getEditor }) {
  return {
    attributes: {
      class: 'tiptap-editor',
    },
    transformPastedHTML(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const el of doc.querySelectorAll('[style]')) {
        el.style.removeProperty('color');
        el.style.removeProperty('background-color');
        el.style.removeProperty('font-family');
        el.style.removeProperty('font-size');
        if (!el.style.cssText.trim()) el.removeAttribute('style');
      }
      for (const img of doc.querySelectorAll('img')) {
        if (isLocalImageSrc(img.getAttribute('src'))) img.remove();
      }
      return doc.body.innerHTML;
    },
    handleTextInput(_view, from, to, text) {
      lastTextInputAt.value = Date.now();
      lastTextInputInfo.value = { from, to, text };
      return false;
    },
    handlePaste(view, event) {
      if (!event?.clipboardData) return false;
      if (props.readonly) return false;
      const syncedId = selectionSyncedReferenceId(view.state);
      if (syncedId && isSyncedLocked(syncedId)) {
        notifySyncedBlockLocked();
        return true;
      }
      const markdown = event.clipboardData.getData('text/markdown');
      const text = markdown || event.clipboardData.getData('text/plain');
      const html = event.clipboardData.getData('text/html');
      // Images on their own (a screenshot, an image copied from a page or Finder) are uploaded, and
      // put in once they are. With text too, it's the text being pasted (Word and Excel add a
      // picture of it), so that's pasted as usual.
      if (!text.trim()) {
        const files = imageFiles(event.clipboardData);
        const blobSrcs = files.length ? [] : [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')]
          .map((img) => img.getAttribute('src'))
          .filter((src) => /^blob:/i.test(src || ''));
        if (files.length || blobSrcs.length) {
          event.preventDefault();
          const pos = view.state.selection.from;
          (files.length ? Promise.resolve(files) : blobImageFiles(blobSrcs)).then((found) => insertImageFiles(found, pos));
          return true;
        }
      }
      const parsed = parseBlockUrl(text);
      if (parsed?.blockId) {
        const confirmed = window.confirm('Paste as a synced block reference?');
        if (confirmed) {
          insertSyncedBlockFromUrl(text);
          return true;
        }
      }
      // Pasted Markdown becomes blocks, read by Tiptap's Markdown extension (to-dos and tables included)
      if (shouldHandleMarkdownPaste(text, html, view.state) && getEditor()?.markdown) {
        event.preventDefault();
        getEditor().chain().focus().insertContent(liftImagesForPaste(text), { contentType: 'markdown' }).run();
        return true;
      }
      return false;
    },
    handleDrop(view, event, _slice, moved) {
      dragScroll.restoreAfterDrop();
      // Image files dropped in from outside the page are uploaded, and put in where they're dropped
      const files = moved || props.readonly ? [] : imageFiles(event?.dataTransfer);
      if (!files.length) return false;
      event.preventDefault();
      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
      insertImageFiles(files, pos);
      return true;
    },
    handleKeyDown(view, event) {
      const syncedId = selectionSyncedReferenceId(view.state);
      if (syncedId && isSyncedLocked(syncedId)) {
        const isModifier = event.metaKey || event.ctrlKey || event.altKey;
        const editKeys = ['Backspace', 'Delete', 'Enter', 'Tab'];
        const isTyping = event.key && event.key.length === 1 && !isModifier;
        const isEdit = isTyping || editKeys.includes(event.key);
        if (!isEdit) return false;
        notifySyncedBlockLocked();
        return true;
      }
      if (isCollabEnabled.value && (event.metaKey || event.ctrlKey)) {
        const key = event.key ? event.key.toLowerCase() : '';
        const wantsUndo = key === 'z' && !event.shiftKey;
        const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey);
        if (wantsUndo || wantsRedo) {
          const command = wantsUndo ? 'undo' : 'redo';
          const handled = getEditor()?.commands?.[command]?.() ?? false;
          if (undoDebugEnabled()) {
            logUndoDebug('shortcut', {
              command,
              handled,
              stacks: describeUndoStacks(view.state),
            });
          }
          if (handled) {
            event.preventDefault();
            return true;
          }
        }
      }
      if (
        event.key === 'Backspace'
        && !event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        const { state } = view;
        const { selection } = state;
        if (selection.empty) {
          const first = state.doc.childCount ? state.doc.child(0) : null;
          if (
            first?.type?.name === 'paragraph'
            && first.content?.size === 0
            && state.doc.childCount > 1
            && selection.$from.depth >= 1
            && selection.$from.node(1) === first
            && selection.$from.parentOffset === 0
          ) {
            // The empty first line goes; the cursor stays, at the start of the line now first (it was
            // taken out of the editor, so the next key went nowhere)
            event.preventDefault();
            const tr = state.tr.delete(0, first.nodeSize);
            // A text position (not an image or divider now first, which the next key would delete)
            const start = Selection.findFrom(tr.doc.resolve(0), 1, true) ?? Selection.atStart(tr.doc);
            view.dispatch(tr.setSelection(start).scrollIntoView());
            return true;
          }
        }
      }
      if (
        event.key === 'Enter'
        && !event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        const { state } = view;
        const { selection } = state;
        if (!selection.empty) return false;
        if (hasAncestorOfType(selection.$from, INDENT_EXCLUDED_ANCESTORS)) return false;
        const target = findIndentTarget(selection.$from);
        if (!target) return false;
        const indent = Number.isFinite(target.node.attrs?.indent) ? target.node.attrs.indent : 0;
        if (indent <= 0) return false;
        if (target.node.content?.size !== 0) return false;
        event.preventDefault();
        const tr = state.tr.setNodeMarkup(target.pos, target.node.type, { ...target.node.attrs, indent: 0 }, target.node.marks);
        view.dispatch(tr);
        return true;
      }
      if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const { state } = view;
        const { selection } = state;
        const handledCodeBlock = applyCodeBlockIndentation(state, view.dispatch, event.shiftKey);
        if (handledCodeBlock) {
          event.preventDefault();
          return true;
        }
        if (hasAncestorOfType(selection.$from, INDENT_EXCLUDED_ANCESTORS) || hasAncestorOfType(selection.$to, INDENT_EXCLUDED_ANCESTORS)) {
          // Prevent Tab escaping to browser chrome (Safari URL bar etc).
          // Return false so Tiptap's built-in ListItem/TaskItem keyboard shortcuts
          // (sinkListItem / liftListItem) handle the actual indent/outdent.
          event.preventDefault();
          return false;
        }
        const targets = collectIndentTargets(state);
        if (!targets.length) return false;
        event.preventDefault();
        const delta = event.shiftKey ? -1 : 1;
        let tr = state.tr;
        targets.forEach(({ node, pos }) => {
          const current = Number.isFinite(node.attrs?.indent) ? node.attrs.indent : 0;
          const next = Math.max(0, Math.min(MAX_TEXT_INDENT, current + delta));
          if (next === current) return;
          tr = tr.setNodeMarkup(pos, node.type, { ...node.attrs, indent: next }, node.marks);
        });
        if (tr.docChanged) {
          view.dispatch(tr);
          return true;
        }
      }
      return false;
    },
    handleClick(view, _pos, event) {
      if (!event || event.button !== 0) return false;
      if (shouldInsertClickPlaceholder(view, event)) {
        return insertClickPlaceholder(view);
      }
      return false;
    },
  };
}
