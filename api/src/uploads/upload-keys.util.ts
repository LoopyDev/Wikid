// An upload's key (its page's id / its file's name) from an address to it, as saved in a page:
// /api/uploads/<key>, /uploads/<key>, or with a site's name in front.
export function uploadKeyOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasUploads = trimmed.includes('/uploads/') || trimmed.startsWith('uploads/');
  if (!hasUploads) return null;
  try {
    const url = new URL(trimmed, 'http://localhost');
    const marker = '/uploads/';
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return null;
    const key = url.pathname.slice(idx + marker.length);
    return key || null;
  } catch {
    return null;
  }
}

/** The keys of every upload a page's content (or any part of it) points at. */
export function uploadKeysIn(value: unknown, keys = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    const key = uploadKeyOf(value);
    if (key) keys.add(key);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => uploadKeysIn(entry, keys));
  } else if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((entry) => uploadKeysIn(entry, keys));
  }
  return keys;
}
