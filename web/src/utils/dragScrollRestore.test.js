import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDragScrollRestore } from './dragScrollRestore';

describe('createDragScrollRestore', () => {
  let frame;
  beforeEach(() => {
    document.body.innerHTML = '<div class="wikid-mainframe"></div>';
    frame = document.querySelector('.wikid-mainframe');
    frame.scrollTop = 120;
    vi.stubGlobal('requestAnimationFrame', (fn) => fn());
  });

  it('puts the scroll position back after a drop during a block drag', () => {
    const restore = createDragScrollRestore();
    restore.start();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    restore.restoreAfterDrop();
    frame.scrollTop = 900; // the browser scrolls on drop
    raf.mock.calls[0][0]();
    expect(frame.scrollTop).toBe(120);
  });

  it('does nothing for drops that are not block drags, or after stop()', () => {
    const restore = createDragScrollRestore();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    restore.restoreAfterDrop();
    restore.start();
    restore.stop();
    restore.restoreAfterDrop();
    expect(raf).not.toHaveBeenCalled();
  });

  it('only restores once per drag', () => {
    const restore = createDragScrollRestore();
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    restore.start();
    restore.restoreAfterDrop();
    restore.restoreAfterDrop();
    expect(raf).toHaveBeenCalledTimes(1);
  });
});
