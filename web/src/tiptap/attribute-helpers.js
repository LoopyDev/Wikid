const toKebabCase = (str) => str.replace(/([A-Z])/g, '-$1').toLowerCase();

/**
 * Returns a Tiptap attribute definition for a plain string data-attribute.
 * @param {string} name - camelCase attribute name (also used to derive data-* attr)
 * @param {string} [defaultValue='']
 */
export function stringAttr(name, defaultValue = '') {
  const dataAttr = `data-${toKebabCase(name)}`;
  return {
    default: defaultValue,
    parseHTML: (element) => element.getAttribute(dataAttr) || defaultValue,
    renderHTML: (attrs) => (attrs[name] ? { [dataAttr]: attrs[name] } : {}),
  };
}

/**
 * Returns a Tiptap attribute definition for a JSON-serialised data-attribute.
 * @param {string} name - camelCase attribute name (also used to derive data-* attr)
 * @param {*} [defaultValue=null]
 */
export function jsonAttr(name, defaultValue = null) {
  const dataAttr = `data-${toKebabCase(name)}`;
  return {
    default: defaultValue,
    parseHTML: (element) => {
      const raw = element.getAttribute(dataAttr);
      if (!raw) return defaultValue;
      try {
        return JSON.parse(raw);
      } catch {
        return defaultValue;
      }
    },
    renderHTML: (attrs) => {
      if (!attrs[name]) return {};
      try {
        return { [dataAttr]: JSON.stringify(attrs[name]) };
      } catch {
        return {};
      }
    },
  };
}
