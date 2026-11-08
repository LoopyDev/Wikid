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

/** The upload's key (page id / file name), or null when `src` isn't an upload. */
export function uploadKey(src) {
  if (typeof src !== 'string') return null;
  return src.trim().match(UPLOAD)?.[1] ?? null;
}

/** The same, as a full address (with this site's name), for use outside Wikid: a Markdown file. */
export function absoluteUploadSrc(src, apiBase = API_BASE, origin = globalThis.location?.origin || '') {
  const resolved = uploadSrc(src, apiBase);
  return typeof resolved === 'string' && resolved.startsWith('/') ? `${origin}${resolved}` : resolved;
}
