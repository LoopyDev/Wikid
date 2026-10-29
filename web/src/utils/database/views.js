import { stringifyValue } from './cellValues';

// Database views: view types, sorting, filter operators and view settings.

export const compareNullable = (a, b, compare) => {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return compare(a, b);
};

export const sortByType = (type, aRaw, bRaw) => {
  if (type === 'NUMBER') {
    const aNum = aRaw === null || aRaw === undefined || aRaw === '' ? null : Number(aRaw);
    const bNum = bRaw === null || bRaw === undefined || bRaw === '' ? null : Number(bRaw);
    return compareNullable(aNum, bNum, (a, b) => a - b);
  }
  if (type === 'DATE') {
    const aTime = aRaw ? new Date(aRaw).getTime() : null;
    const bTime = bRaw ? new Date(bRaw).getTime() : null;
    return compareNullable(aTime, bTime, (a, b) => a - b);
  }
  if (type === 'CHECKBOX') {
    const aBool = aRaw ? 1 : 0;
    const bBool = bRaw ? 1 : 0;
    return compareNullable(aBool, bBool, (a, b) => a - b);
  }
  const aText = stringifyValue(aRaw).toLowerCase();
  const bText = stringifyValue(bRaw).toLowerCase();
  return compareNullable(aText, bText, (a, b) => a.localeCompare(b));
};

// Parse a value into a comparable timestamp for DATE filters.
export const toComparableDate = (value) => {
  if (value == null || value === '') return null;
  const ts = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
};

// ---------------------------------------------------------------------------
// Saved views (persisted, filterable Table / Gallery / Board views)
// ---------------------------------------------------------------------------
export const VIEW_TYPES = ['TABLE', 'GALLERY', 'BOARD'];

export const VIEW_TYPE_LABELS = { TABLE: 'Table', GALLERY: 'Gallery', BOARD: 'Board' };

export const OPERATOR_LABELS = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  before: 'before',
  after: 'after',
  on_or_before: 'on or before',
  on_or_after: 'on or after',
  is_checked: 'is checked',
  is_unchecked: 'is unchecked',
};

export const operatorsForFieldType = (type) => {
  switch (type) {
    case 'CHECKBOX':
      return ['is_checked', 'is_unchecked'];
    case 'NUMBER':
      return ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
    case 'DATE':
      return ['is', 'is_not', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'];
    case 'SELECT':
      return ['is', 'is_not', 'is_empty', 'is_not_empty'];
    case 'MULTI_SELECT':
    case 'RELATION':
      return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
    default:
      return ['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty'];
  }
};

export const operatorNeedsValue = (operator) =>
  !['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked'].includes(operator);

export const normalizeViewType = (value) => {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VIEW_TYPES.includes(upper) ? upper : 'TABLE';
};

export const normalizeViewConfig = (config) => {
  const src = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const rawFilters = src.filters && typeof src.filters === 'object' ? src.filters : {};
  const rules = Array.isArray(rawFilters.rules)
    ? rawFilters.rules
        .filter((rule) => rule && typeof rule === 'object' && rule.fieldId && rule.operator)
        .map((rule) => ({
          fieldId: String(rule.fieldId),
          operator: String(rule.operator),
          value: rule.value === undefined ? null : rule.value,
        }))
    : [];
  const sorts = Array.isArray(src.sorts)
    ? src.sorts
        .filter((sort) => sort && typeof sort === 'object' && sort.fieldId)
        .map((sort) => ({ fieldId: String(sort.fieldId), direction: sort.direction === 'desc' ? 'desc' : 'asc' }))
    : [];
  const hiddenFieldIds = Array.isArray(src.hiddenFieldIds)
    ? src.hiddenFieldIds.filter((id) => typeof id === 'string')
    : [];
  return {
    filters: { match: rawFilters.match === 'OR' ? 'OR' : 'AND', rules },
    sorts,
    hiddenFieldIds,
    groupFieldId: typeof src.groupFieldId === 'string' ? src.groupFieldId : null,
    cardFieldId: typeof src.cardFieldId === 'string' ? src.cardFieldId : null,
    // Gallery cards: the columns they show (null: every column the view shows), and how many of a
    // cover's linked rows show before "Show more"
    cardFieldIds: Array.isArray(src.cardFieldIds) ? src.cardFieldIds.filter((id) => typeof id === 'string') : null,
    coverMaxItems: Number.isInteger(src.coverMaxItems) && src.coverMaxItems >= 1 ? src.coverMaxItems : null,
  };
};
