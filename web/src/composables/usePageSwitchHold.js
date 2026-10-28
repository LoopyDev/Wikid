import { onBeforeUnmount, ref, watch } from 'vue';

// Moving to another page: until the new page's content is in, a still copy of the page you're
// leaving stays where the page body goes, so there's never a blank moment. A quick switch just
// swaps; a slower one fades the copy, and a slow one shows placeholder lines instead.
export const FADE_AFTER_MS = 150;
export const SKELETON_AFTER_MS = 500;
// Never hold on for longer than this, ready or not
const GIVE_UP_MS = 6000;
const REVEAL_MS = 160;

// Parts of the editor that only make sense live: menus, handles and other people's cursors
const LIVE_ONLY = '.drag-handle, .bubble-menu, .emoji-menu, .collaboration-carets__caret, .collaboration-carets__selection, .ProseMirror-gapcursor';
// Embeds would load again (or show blank) in a copy, so they become a plain box of the same size
const EMBEDS = 'iframe, video, audio, canvas, object, embed';

/** A still, non-interactive copy of a page body. */
export function stillCopy(body) {
  const copy = body.cloneNode(true);
  const originals = body.querySelectorAll(EMBEDS);
  copy.querySelectorAll(EMBEDS).forEach((el, index) => {
    const rect = originals[index]?.getBoundingClientRect();
    const box = document.createElement('div');
    box.className = 'page-hold__embed';
    if (rect) {
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
    }
    el.replaceWith(box);
  });
  copy.querySelectorAll(LIVE_ONLY).forEach((el) => el.remove());
  copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
  copy.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
  copy.removeAttribute('id');
  return copy;
}

/** Where the text sits in a page body, so placeholder lines can line up with it. */
const textInsets = (body) => {
  const editor = body?.querySelector('.ProseMirror');
  if (!editor) return null;
  const outer = body.getBoundingClientRect();
  const inner = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  return {
    left: Math.max(0, inner.left - outer.left + (parseFloat(style.paddingLeft) || 0)),
    right: Math.max(0, outer.right - inner.right + (parseFloat(style.paddingRight) || 0)),
  };
};

export function usePageSwitchHold() {
  // null when not holding, otherwise 'hold' (the copy as it was), 'fade' or 'skeleton'
  const stage = ref(null);
  // Briefly true as the new page's content fades in
  const revealing = ref(false);
  // Where the copy goes, inside the new page
  const holdEl = ref(null);
  // Where the page being left had its text: { left, right } in pixels, or null
  const insets = ref(null);
  let copy = null;
  const timers = new Set();
  const later = (fn, ms) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };

  const release = () => {
    if (!stage.value) return;
    clearTimers();
    stage.value = null;
    copy = null;
    revealing.value = true;
    later(() => {
      revealing.value = false;
    }, REVEAL_MS);
  };

  /** Starts holding on to `body` (the page body being left, if any). */
  const start = (body) => {
    clearTimers();
    revealing.value = false;
    // Moving on again while still holding keeps what's on screen, rather than copying a page
    // that never appeared
    if (!stage.value) {
      copy = body ? stillCopy(body) : null;
      insets.value = textInsets(body);
      stage.value = 'hold';
    }
    if (stage.value === 'hold' && copy) {
      later(() => {
        if (stage.value === 'hold') stage.value = 'fade';
      }, FADE_AFTER_MS);
    }
    if (stage.value !== 'skeleton') {
      later(() => {
        if (stage.value) stage.value = 'skeleton';
      }, copy ? SKELETON_AFTER_MS : FADE_AFTER_MS);
    }
    later(release, GIVE_UP_MS);
  };

  watch(holdEl, (el) => {
    const slot = el?.querySelector('.page-hold__copy');
    if (slot && copy) slot.replaceChildren(copy);
  });

  onBeforeUnmount(clearTimers);

  return { stage, revealing, holdEl, insets, start, release };
}
