/**
 * An image file's size in pixels, as the browser will show it, or null if it can't be read (an
 * SVG, say). Used to keep an image's space on the page while it loads.
 */
export async function readImageSize(file) {
  if (!file || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** The image node attributes for that size. */
export const imageSizeAttrs = (size) => ({ naturalWidth: size?.width || null, naturalHeight: size?.height || null });
