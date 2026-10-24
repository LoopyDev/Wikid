/**
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format as locale date string (date only).
 * @param {unknown} value
 * @returns {string}
 */
export function formatDate(value) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString() : '';
}

/**
 * Format as locale date + time string.
 * @param {unknown} value
 * @returns {string}
 */
export function formatDateTime(value) {
  const d = parseDate(value);
  return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
