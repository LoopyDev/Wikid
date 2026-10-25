// Placing floating menus next to the selection without running off screen.

export const rectFromClientRects = (rects) => {
  const filtered = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  if (!filtered.length) return null;
  let top = filtered[0].top;
  let left = filtered[0].left;
  let right = filtered[0].right;
  let bottom = filtered[0].bottom;
  filtered.slice(1).forEach((rect) => {
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  });
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    width,
    height,
    top,
    right,
    bottom,
    left,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
};

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const positionBubbleMenu = (buttonRef, menuRef, posRef) => {
  if (typeof window === 'undefined') return;
  const buttonEl = buttonRef.value;
  if (!buttonEl?.getBoundingClientRect) return;
  const buttonRect = buttonEl.getBoundingClientRect();
  const bubbleRect = buttonEl.closest?.('.bubble-menu')?.getBoundingClientRect?.() || buttonRect;
  const menuRect = menuRef.value?.getBoundingClientRect?.();
  const menuHeight = menuRect?.height || 240;
  const menuWidth = menuRect?.width || 220;
  const gap = 6;
  const margin = 8;
  const viewportHeight = window.innerHeight || 0;
  const viewportWidth = window.innerWidth || 0;
  let top = buttonRect.bottom + gap;
  let left = buttonRect.left;
  const shouldSide = top + menuHeight > viewportHeight - margin;
  if (shouldSide) {
    top = bubbleRect.top;
    left = bubbleRect.right + gap;
    if (left + menuWidth > viewportWidth - margin) {
      left = bubbleRect.left - menuWidth - gap;
    }
  }
  top = clamp(top, margin, Math.max(margin, viewportHeight - menuHeight - margin));
  left = clamp(left, margin, Math.max(margin, viewportWidth - menuWidth - margin));
  posRef.value = { top, left };
};
