/**
 * Shows an image on a page of its own, in a new tab. For now that's the image itself; an image
 * viewer can take over here.
 */
export function openImage(src) {
  if (!src) return;
  window.open(src, '_blank', 'noopener');
}
