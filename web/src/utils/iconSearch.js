// Finding Bootstrap icons by name, by the tags the Bootstrap Icons site gives them ("home" finds
// "house") and by category. The categories and tags (iconMeta.json, from
// scripts/build-icon-meta.mjs) load only once the picker searches or browses.

// The opened-out picker (IconBrowser), shown over the page: clicks in it aren't "outside" the
// picker that opened it
export const ICON_BROWSER_SELECTOR = '.icon-browser';
export const isInIconBrowser = (target) => !!target?.closest?.(ICON_BROWSER_SELECTOR);

let metaPromise = null;

/** The icons' categories and tags: { categories: [name], icons: { name: [[categoryIndex], [tag]] } }. */
export const loadIconMeta = () => {
  metaPromise ||= import('./iconMeta.json').then((module) => module.default || module);
  return metaPromise;
};

/** The categories, by name, in order. */
export const iconCategories = (meta) => (Array.isArray(meta?.categories) ? meta.categories : []);

/**
 * The icons (entries with a `name`) that match `query` (by name or tag) and are in `category`
 * (a category name, or empty for any). Without `meta`, only names are searched.
 */
export const searchIcons = (entries, query, { meta = null, category = '' } = {}) => {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const categoryIndex = category && meta ? iconCategories(meta).indexOf(category) : -1;
  if (category && categoryIndex < 0) return [];
  return entries.filter((entry) => {
    const [categories = [], tags = []] = meta?.icons?.[entry.name] || [];
    if (categoryIndex >= 0 && !categories.includes(categoryIndex)) return false;
    // Every word appears in the name or a tag
    return words.every((word) => entry.name.includes(word) || tags.some((tag) => tag.includes(word)));
  });
};
