// Undo and redo for a text box the page keeps in step with others (the page title): the browser's own
// went back one letter at a time there, as what each key sets off (saving it to the live document,
// the sidebar) broke its runs of typing up. A run of typing or deleting is one step, until a pause,
// a move of the cursor, or a switch between typing and deleting. Once the text changes from
// elsewhere (someone else renaming the page), the history starts again, so an undo never puts back
// a copy from before their change and overwrites it.

const RUN_GAP_MS = 1000;
const LIMIT = 100;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

/** @param {{ apply: (el: HTMLTextAreaElement | HTMLInputElement) => void }} options — called after an undo or redo changes the text */
export function useTextHistory({ apply }) {
  let undo = [];
  let redo = [];
  let last = null; // { kind, at, caret } of the last change, while a run can go on
  let before = null; // the text before the change about to happen, and whether it carries a run on
  let known = null; // the text as this history last left it

  const snapshot = (el) => ({ value: el.value, start: el.selectionStart, end: el.selectionEnd });

  const reset = () => {
    undo = [];
    redo = [];
    last = null;
    before = null;
    known = null;
  };

  // Changed from elsewhere since: start again
  const checkKnown = (el) => {
    if (known !== null && el.value !== known) reset();
  };

  const step = (el, back) => {
    const target = (back ? undo : redo).pop();
    if (!target) return;
    (back ? redo : undo).push(snapshot(el));
    el.value = target.value;
    el.setSelectionRange(target.start, target.end);
    last = null;
    known = el.value;
    apply(el);
  };

  const onBeforeInput = (event) => {
    const el = event.target;
    checkKnown(el);
    const type = event.inputType || '';
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (!el.readOnly && !el.disabled) step(el, type === 'historyUndo');
      return;
    }
    // Typing through an input method (accents, Japanese, phones) is typing too
    const kind = type.startsWith('delete') ? 'delete' : type === 'insertText' || type === 'insertCompositionText' || event.isComposing ? 'type' : type;
    const goesOn = !!last && last.kind === kind && (kind === 'type' || kind === 'delete') && Date.now() - last.at < RUN_GAP_MS
      && el.selectionStart === el.selectionEnd && el.selectionStart === last.caret;
    before = { snap: snapshot(el), kind, goesOn };
  };

  // After the change, if there was one (a Backspace at the start changes nothing, and keeps the redo)
  const onInput = (event) => {
    const el = event.target;
    if (before && el.value !== before.snap.value) {
      if (!before.goesOn) {
        undo.push(before.snap);
        if (undo.length > LIMIT) undo.shift();
      }
      redo = [];
      last = { kind: before.kind, at: Date.now(), caret: el.selectionStart };
    }
    before = null;
    known = el.value;
  };

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (Cmd on a Mac); left to the browser when there's nothing to do
  const onKeyDown = (event) => {
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
    if (!mod || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    const back = key === 'z' && !event.shiftKey;
    if (key !== 'z' && !(key === 'y' && !isMac)) return;
    const el = event.target;
    checkKnown(el);
    if (el.readOnly || el.disabled || !(back ? undo : redo).length) return;
    event.preventDefault();
    step(el, back);
  };

  return { onBeforeInput, onInput, onKeyDown, reset };
}
