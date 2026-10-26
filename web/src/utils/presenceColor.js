// A stable colour per user, for showing who else is here (cursors, avatars).

export const presencePalette = ['#f97316', '#22d3ee', '#a855f7', '#ef4444', '#10b981', '#facc15', '#14b8a6', '#3b82f6', '#f472b6'];

export const colorFromId = (id = '') => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % presencePalette.length;
  return presencePalette[idx];
};
