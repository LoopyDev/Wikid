import { nextTick, onBeforeUnmount, watch } from 'vue';

// A board scrolled down keeps every column's cards in sight. A column whose cards fit in the board's
// box stays put under its header; a longer one scrolls until its last card is at the bottom of the
// box, then stays there, while a longer one still goes on. Each column's cards are sticky, with a
// stopping place of their own: under the header, or (when they don't fit) as high as leaves their
// last card at the box's bottom. Worked out again when the box, a header or the cards change size.

const px = (value) => parseFloat(value) || 0;

export function useBoardStickyCards(boxRef, enabled, changes) {
  let observer = null;
  let frame = 0;
  // Each start of watching, so one overtaken (or stopped) while it waited doesn't go on
  let generation = 0;

  const place = () => {
    frame = 0;
    const box = boxRef.value;
    if (!box || !enabled.value) return;
    const boxBelow = px(getComputedStyle(box).paddingBottom);
    for (const column of box.querySelectorAll('.db-board__column')) {
      const header = column.querySelector('.db-board__column-header');
      const cards = column.querySelector('.db-board__cards');
      if (!header || !cards) continue;
      // (The space round the cards is their own padding, in their height)
      const underHeader = header.offsetHeight;
      const lastCardAtBottom = box.clientHeight - boxBelow - cards.offsetHeight;
      cards.style.setProperty('--db-cards-top', `${Math.min(underHeader, lastCardAtBottom)}px`);
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(place);
  };

  const stop = () => {
    generation += 1;
    observer?.disconnect();
    observer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
  // The box, and each column's header and cards, watched for size changes (the columns themselves
  // change when the cards do: moved, added, filtered, regrouped)
  const observe = async () => {
    stop();
    const mine = generation;
    if (!enabled.value || typeof ResizeObserver !== 'function') return;
    await nextTick();
    const box = boxRef.value;
    if (mine !== generation || !box) return;
    observer = new ResizeObserver(schedule);
    observer.observe(box);
    for (const el of box.querySelectorAll('.db-board__column-header, .db-board__cards')) observer.observe(el);
    schedule();
  };
  watch([boxRef, enabled, changes], observe, { flush: 'post' });
  onBeforeUnmount(stop);
}
