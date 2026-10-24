// Loaded from the bootstrap-icons package rather than a vendored copy
const iconModules = import.meta.glob('/node_modules/bootstrap-icons/icons/*.svg', { as: 'raw', eager: true });

const iconEntries = Object.entries(iconModules)
  .map(([path, svg]) => {
    const file = path.split('/').pop() || '';
    const name = file.replace(/\.svg$/i, '');
    return {
      id: `icon:${name}`,
      name,
      svg,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const iconMap = new Map(iconEntries.map((entry) => [entry.id, entry]));

const isIconToken = (value) => typeof value === 'string' && value.startsWith('icon:');

const parseIconToken = (value) => {
  if (!isIconToken(value)) return null;
  const [id, color = ''] = value.split('|');
  return { id, color };
};

const buildIconToken = (id, color) => {
  if (!id) return '';
  const trimmed = typeof color === 'string' ? color.trim() : '';
  return trimmed ? `${id}|${trimmed}` : id;
};

const resolveIcon = (value, fallback = '📄') => {
  if (isIconToken(value)) {
    const parsed = parseIconToken(value);
    // The old vendored set had duplicates like "pin copy"; map saved ones to the original icon
    const entry = parsed ? iconMap.get(parsed.id) || iconMap.get(parsed.id.replace(/ copy( \d+)?$/, '')) : null;
    if (entry) {
      return { type: 'svg', ...entry, color: parsed?.color || '' };
    }
    return { type: 'emoji', text: fallback };
  }
  const text = value || fallback;
  return { type: 'emoji', text };
};

export { iconEntries, isIconToken, parseIconToken, buildIconToken, resolveIcon };
