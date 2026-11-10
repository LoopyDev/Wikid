// A URL cell's value as a link to open, or null when it isn't one that's safe to: only web
// addresses and email links, never javascript:, data: or the like, and never one dressed up with a
// user name ("https://bank.example@evil.example" opens evil.example). A bare "example.com" opens
// over https, a bare email address as an email.
const BARE_HOST = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+)(:\d{1,5})?([/?#].*)?$/i;
const BARE_EMAIL = /^[^\s@/:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export const linkHref = (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || /\s/.test(text)) return null;
  let candidate = null;
  if (/^(https?:\/\/|mailto:)/i.test(text)) candidate = text;
  else if (BARE_EMAIL.test(text)) candidate = `mailto:${text}`;
  else if (BARE_HOST.test(text)) candidate = `https://${text}`;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'mailto:') return BARE_EMAIL.test(decodeURIComponent(url.pathname)) ? url.href : null;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
};
