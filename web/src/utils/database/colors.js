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

export const multiSelectDotStyle = (color) => ({
  backgroundColor: color || 'rgba(148, 163, 184, 0.35)',
  borderColor: color || 'rgba(148, 163, 184, 0.6)',
});
