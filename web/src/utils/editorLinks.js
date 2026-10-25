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
