// Dropping a dragged block makes the browser scroll the page; this puts the scroll position back.
// start() when a block drag begins, stop() when it ends, restoreAfterDrop() from the drop handler.
const getScrollContainer = () => {
  if (typeof document === 'undefined') return null;
  return document.querySelector('.wikid-mainframe') || document.scrollingElement || document.documentElement;
};

export function createDragScrollRestore() {
  let active = false;
  return {
    start() {
      active = true;
    },
    stop() {
      active = false;
    },
    restoreAfterDrop() {
      if (!active) return;
      active = false;
      const container = getScrollContainer();
      if (!container) return;
      const { scrollTop: top, scrollLeft: left } = container;
      requestAnimationFrame(() => {
        container.scrollTop = top;
        container.scrollLeft = left;
      });
    },
  };
}
