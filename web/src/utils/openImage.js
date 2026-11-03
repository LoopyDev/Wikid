/**
 * Shows images full screen, over the page, starting at `index`: zoom with a click, the wheel or a
 * pinch, drag to pan, and swipe or the arrow keys to move through the rest of `images`. Each image is
 * `{ src, width, height, alt, element }`; `element` is the image on the page, which it zooms out of
 * and back into. The viewer (PhotoSwipe) loads the first time it's used.
 */
export async function openImages(images, index = 0) {
  const items = images.filter((image) => image?.src).map((image) => ({ ...image }));
  const start = items[index];
  if (!start) return;
  let PhotoSwipe;
  try {
    // Its size first, as the viewer lays the image out before it loads
    if (!hasSize(start)) Object.assign(start, await measure(start.src));
    [{ default: PhotoSwipe }] = await Promise.all([import('photoswipe'), import('photoswipe/style.css')]);
  } catch {
    // An image that won't load, or a viewer that won't, still opens on a page of its own
    window.open(start.src, '_blank', 'noopener');
    return;
  }
  const pswp = new PhotoSwipe({
    dataSource: items,
    index,
    bgOpacity: 0.9,
    loop: false,
    closeTitle: 'Close',
    zoomTitle: 'Zoom',
    arrowPrevTitle: 'Previous image',
    arrowNextTitle: 'Next image',
    errorMsg: "This image couldn't be loaded",
  });
  pswp.on('uiRegister', () => {
    pswp.ui.registerElement({
      name: 'open-original',
      order: 8,
      isButton: true,
      tagName: 'a',
      title: 'Open in a new tab',
      ariaLabel: 'Open in a new tab',
      html: '<svg class="pswp__icn" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M18 8h6v6M24 8l-9 9M14 10H9a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      onInit: (el) => {
        el.target = '_blank';
        el.rel = 'noopener';
        const update = () => { el.href = pswp.currSlide?.data?.src || ''; };
        pswp.on('change', update);
        update();
      },
    });
  });
  // Escape is the viewer's alone while it's up, so a row page it opened over stays open. The viewer
  // ignores it while it's still opening; it closes once open instead.
  const onEscape = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (pswp.opener.isOpening) pswp.on('openingAnimationEnd', () => pswp.close());
  };
  document.addEventListener('keydown', onEscape);
  pswp.on('destroy', () => document.removeEventListener('keydown', onEscape));
  pswp.init();
  // The others' sizes, for any saved without them, as they're measured
  items.forEach((item, i) => {
    if (hasSize(item)) return;
    measure(item.src).then((size) => {
      Object.assign(item, size);
      if (!pswp.isDestroying) pswp.refreshSlideContent(i);
    }, () => {});
  });
}

const hasSize = (image) => Number(image.width) > 0 && Number(image.height) > 0;

// Measured once each, by loading it (usually from the cache, as it's on the page already)
const sizes = new Map();
function measure(src) {
  if (!sizes.has(src)) {
    const img = new Image();
    img.src = src;
    const size = img.decode().then(() => ({ width: img.naturalWidth, height: img.naturalHeight }));
    size.catch(() => sizes.delete(src));
    sizes.set(src, size);
  }
  return sizes.get(src);
}
