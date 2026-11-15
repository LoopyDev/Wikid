import { onBeforeUnmount, ref, watch } from 'vue';

// The height a box can be to end at the bottom of the window (of the area that scrolls the page),
// from where it starts: so a board that scrolls in its own box has its bottom, and its sideways
// scrollbar, in sight, rather than a tall page's length below. One starting too far down for that
// is a window high (less a margin), for the page to scroll into view first.
const GAP = 16;
const MIN = 320;

/** The scrolling area around an element: the nearest one that scrolls up and down, or none (the window). */
const scrollArea = (el) => {
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return null;
};

export function useFitToWindow(elRef, enabled) {
  const maxHeight = ref(null);
  let observer = null;
  let listening = false;

  const measure = () => {
    const el = elRef.value;
    if (!el || !enabled.value) {
      maxHeight.value = null;
      return;
    }
    // (Looked for each time: a narrower window can move the scrolling to another element)
    const area = scrollArea(el);
    const top = area ? area.getBoundingClientRect().top : 0;
    const height = area ? area.clientHeight : window.innerHeight;
    const scrolled = area ? area.scrollTop : window.scrollY;
    // Where it starts in what scrolls, so the same however far it's scrolled
    const offset = el.getBoundingClientRect().top - top + scrolled;
    const fit = height - offset - GAP;
    maxHeight.value = Math.round(fit >= MIN ? fit : Math.max(MIN, height - GAP * 2));
  };

  const stop = () => {
    observer?.disconnect();
    observer = null;
    if (listening) window.removeEventListener('resize', measure);
    listening = false;
  };
  watch(
    [elRef, enabled],
    ([el, on]) => {
      stop();
      if (!el || !on) {
        maxHeight.value = null;
        return;
      }
      const area = scrollArea(el);
      // Again when the area changes size, or anything between it and the box does (what's above
      // the box growing or shrinking moves it: a notice over the columns, a title that wraps, an
      // image above loading); the window's own size when it's the window that scrolls
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => measure());
        if (area) observer.observe(area);
        for (let parent = el.parentElement; parent && parent !== area; parent = parent.parentElement) observer.observe(parent);
      }
      if (!area || typeof ResizeObserver !== 'function') {
        window.addEventListener('resize', measure);
        listening = true;
      }
      measure();
    },
    { flush: 'post' }
  );
  onBeforeUnmount(stop);
  return maxHeight;
}
