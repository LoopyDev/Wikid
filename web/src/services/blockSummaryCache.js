const STORAGE_KEY = 'wikid:block-summary-cache';
const MAX_ENTRIES = 2000;

// FNV-1a 32-bit — deterministic, no deps, fast
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

let _cache = null;

function load() {
  if (_cache !== null) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    _cache = raw ? JSON.parse(raw) : {};
  } catch {
    _cache = {};
  }
}

function evict(targetCount) {
  const entries = Object.entries(_cache).sort((a, b) => a[1].ts - b[1].ts);
  entries.slice(0, entries.length - targetCount).forEach(([k]) => delete _cache[k]);
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
  } catch {
    // Storage full — evict half and retry once
    evict(Math.floor(MAX_ENTRIES / 2));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache)); } catch { /* give up */ }
  }
}

export const blockSummaryCache = {
  hash: fnv1a,

  // Blocks shorter than this are never summarised — just include full text
  isShort: (text) => text.length < 50,

  has(hash) {
    load();
    return Object.prototype.hasOwnProperty.call(_cache, hash);
  },

  // Returns { summary, ts } or null
  get(hash) {
    load();
    return _cache[hash] ?? null;
  },

  set(hash, summary) {
    load();
    _cache[hash] = { summary, ts: Date.now() };
    if (Object.keys(_cache).length > MAX_ENTRIES) evict(MAX_ENTRIES);
    persist();
  },
};
