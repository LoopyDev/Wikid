// Colours for select and multi-select choice pills.

export const hexToRgb = (hex) => {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace('#', '');
  if (![3, 6].includes(cleaned.length)) return null;
  const normalized = cleaned.length === 3 ? cleaned.split('').map((char) => char + char).join('') : cleaned;
  const num = Number.parseInt(normalized, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
};

export const rgbaFromHex = (hex, alpha) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

export const multiSelectPillStyle = (color) => {
  if (!color) return {};
  const background = rgbaFromHex(color, 0.18) || color;
  const border = rgbaFromHex(color, 0.45) || color;
  return { backgroundColor: background, borderColor: border };
};

// The colours a row can be given (its row menu), which pills linking to it are shown in; the
// same as the icon colours
export const ROW_COLOR_KEY = '__color';
export const ROW_COLORS = [
  { value: '#0ea5e9', label: 'Sky' },
  { value: '#22c55e', label: 'Green' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#f97316', label: 'Orange' },
  { value: '#ef4444', label: 'Red' },
  { value: '#a855f7', label: 'Purple' },
  { value: '#6366f1', label: 'Indigo' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#94a3b8', label: 'Slate' },
];
/** A row's own colour, or null. */
export const rowColor = (row) => {
  const value = row?.data?.[ROW_COLOR_KEY];
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : null;
};

export const multiSelectDotStyle = (color) => ({
  backgroundColor: color || 'rgba(148, 163, 184, 0.35)',
  borderColor: color || 'rgba(148, 163, 184, 0.6)',
});
