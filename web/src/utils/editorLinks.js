// Link addresses: cleaning up typed links and recognising links to blocks in Wikid.

export const normalizeLinkHref = (raw) => {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(lower);
  if (hasScheme) return trimmed;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }
  return `https://${trimmed}`;
};

export const parseBlockUrl = (text) => {
  if (typeof text !== 'string') return null;
  const anchorMatch = text.match(/#(block-[A-Za-z0-9_-]+)/);
  if (!anchorMatch) return null;
  const blockId = anchorMatch[1].replace(/^block-block-/, 'block-');
  let pageId = null;
  let workspaceId = null;
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost';
    const url = new URL(text, base);
    const parts = url.pathname.split('/').filter(Boolean);
    const docIdx = parts.indexOf('doc');
    if (docIdx >= 0 && parts[docIdx + 1]) {
      pageId = parts[docIdx + 1];
    }
    const wsIdx = parts.indexOf('ws');
    if (wsIdx >= 0 && parts[wsIdx + 1]) {
      workspaceId = decodeURIComponent(parts[wsIdx + 1]);
    }
  } catch {
    // ignore parse failures; keep hash-only behaviour
  }
  return { blockId, pageId, workspaceId };
};

// The page (and block) a link points at, if it's to a page here in Wikid: "/doc/<id>", or this
// site's full address for one, with or without "#block-…"
export const pageLinkTarget = (href) => {
  if (typeof href !== 'string' || !href) return null;
  let url;
  try {
    url = new URL(href, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
  } catch {
    return null;
  }
  if (typeof window !== 'undefined' && url.origin !== window.location.origin) return null;
  const match = url.pathname.match(/\/doc\/([0-9a-fA-F-]{36})$/);
  return match ? { pageId: match[1], hash: url.hash || '' } : null;
};

// Whether a link may go there: web and mail addresses, phone numbers, and places on this site. Not
// javascript:, data: and the like, which run something rather than go somewhere
export const isSafeLinkHref = (href) => {
  if (typeof href !== 'string' || !href.trim()) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim());
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase());
};
