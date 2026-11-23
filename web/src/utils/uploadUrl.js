// Where to fetch a file uploaded to Wikid from. Pages save an upload's address as /api/uploads/...,
// but older ones saved the site's full address too (https://wiki.example.com/api/uploads/...),
// which breaks once the same pages are served from anywhere else: after a restore on another
// machine, or a move to a new domain. Any address of that shape is taken to be this Wikid's.

const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

// An upload's key is the page's id and the file's name. The /api in front is there when the API
// sits behind the web server (production, Docker), and not when it's run on its own (development).
const UPLOAD = /^(?:https?:\/\/[^/?#]+)?(?:\/api)?\/uploads\/([0-9a-f-]{36}\/[^/?#]+)$/i;

/** The address to load an upload from on this Wikid, or `src` as it is when it isn't an upload. */
export function uploadSrc(src, apiBase = API_BASE) {
  const key = uploadKey(src);
  return key ? `${apiBase}/uploads/${key}` : src;
}

/**
 * The address to show an upload at on a page. An upload is filed under the page it was put on, and
 * served to whoever can read that page; shown on another (a duplicated page's images, or ones pasted
 * from elsewhere), it says which page it's on, so it still loads for anyone who can read that one,
 * even once the first page is in the bin, deleted, or private.
 */
export function uploadSrcOn(src, pageId, apiBase = API_BASE) {
  const key = uploadKey(src);
  if (!key) return src;
  const own = key.split('/')[0];
  return pageId && own.toLowerCase() !== String(pageId).toLowerCase()
    ? `${apiBase}/uploads/${key}?page=${encodeURIComponent(pageId)}`
    : `${apiBase}/uploads/${key}`;
}

/** The upload's key (page id / file name), or null when `src` isn't an upload. */
export function uploadKey(src) {
  if (typeof src !== 'string') return null;
  return src.trim().match(UPLOAD)?.[1] ?? null;
}

/**
 * The same, as a full address (with this site's name), for use outside Wikid: a Markdown file. With
 * the page it's on, as uploadSrcOn.
 */
export function absoluteUploadSrc(src, apiBase = API_BASE, origin = globalThis.location?.origin || '', pageId = null) {
  const resolved = uploadSrcOn(src, pageId, apiBase);
  return typeof resolved === 'string' && resolved.startsWith('/') ? `${origin}${resolved}` : resolved;
}
