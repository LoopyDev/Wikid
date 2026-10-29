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

// A timeline of each switch in the browser console, switched on with
// localStorage.setItem('wikid:debug-page-switch', '1')
const debugEnabled = () => {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem('wikid:debug-page-switch') === '1';
  } catch {
    return false;
  }
};
// After letting go, what the page shows a moment later
const AFTER_RELEASE_MS = [0, 100, 300, 1000];

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

/**
 * `describe()`, if given, says what the page shows right now, for the debug timeline.
 */
export function usePageSwitchHold({ describe } = {}) {
  // null when not holding, otherwise 'hold' (the copy as it was), 'fade' or 'skeleton'
  const stage = ref(null);
  // Briefly true as the new page's content fades in, after placeholder lines. From the copy it
  // swaps straight in: fading it in from nothing left a blank moment between the two.
  const revealing = ref(false);
  // Where the copy goes, inside the new page
  const holdEl = ref(null);
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

  let debugStart = 0;
  const debug = (event, details) => {
    if (!debugEnabled()) return;
    const at = Math.round(performance.now() - debugStart);
    let shows = null;
    try {
      shows = describe?.() ?? null;
    } catch (err) {
      shows = { describeFailed: String(err) };
    }
    // As text, so it copies out of the console in full
    console.log(`[page-switch] +${at}ms ${event} ${JSON.stringify({ ...details, stage: stage.value, shows })}`);
  };
  watch(stage, (next, previous) => {
    if (next && previous && next !== previous) debug(`stage ${next}`);
  });

  const release = (reason = 'ready') => {
    if (!stage.value) return;
    debug('release', { reason });
    clearTimers();
    if (debugEnabled()) {
      for (const ms of AFTER_RELEASE_MS) setTimeout(() => debug(`after release +${ms}ms`), ms);
    }
    const fromPlaceholders = stage.value === 'skeleton';
    stage.value = null;
    copy = null;
    if (!fromPlaceholders) return;
    revealing.value = true;
    later(() => {
      revealing.value = false;
    }, REVEAL_MS);
  };

  /** Starts holding on to `body` (the page body being left, if any). */
  const start = (body) => {
    const already = !!stage.value;
    if (!already) debugStart = performance.now();
    clearTimers();
    revealing.value = false;
    // Moving on again while still holding keeps what's on screen, rather than copying a page
    // that never appeared
    if (!stage.value) {
      copy = body ? stillCopy(body) : null;
      stage.value = 'hold';
    }
    debug(already ? 'start again (still holding)' : 'start', { copied: !!copy, copiedText: copy?.textContent?.length ?? 0 });
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
    later(() => release('gave up'), GIVE_UP_MS);
  };

  watch(holdEl, (el) => {
    const slot = el?.querySelector('.page-hold__copy');
    if (slot && copy) slot.replaceChildren(copy);
  });

  onBeforeUnmount(clearTimers);

  return { stage, revealing, holdEl, start, release, debug };
}
