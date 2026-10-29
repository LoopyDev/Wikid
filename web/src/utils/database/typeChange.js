import { toPlainValue } from './collabRows';
import { getRelationConfig, normalizeChoice } from './fieldOptions';

// Changing a column's type: what each cell becomes, and what's kept beside it when it doesn't fit.
// coerceCellValue is the server's rule for what a cell of each type keeps
// (api/src/utils/cell-values.util.ts); both are checked against api/test/fixtures/cell-values.json.

const TRUE_STRINGS = new Set(['true', 'yes', '1', 'y', 'on']);
const FALSE_STRINGS = new Set(['false', 'no', '0', 'off']);
const isUuid = (value) => !!value && /^[0-9a-fA-F-]{36}$/.test(value);

// A value that didn't fit its column when the column's type changed, kept per column so
// changing the type back brings it back
export const KEPT_VALUE_PREFIX = '__kept:';
export const keptValueKey = (fieldId) => `${KEPT_VALUE_PREFIX}${fieldId}`;
const KEPT_TEXT_LIMIT = 10_000;

export const normalizeKeptValue = (value) => {
  const asText = (item) => {
    if (typeof item === 'string') return item.trim().slice(0, KEPT_TEXT_LIMIT);
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
    if (typeof item === 'boolean') return item ? 'Yes' : '';
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const label = item.label || item.id;
      return typeof label === 'string' ? label.trim().slice(0, KEPT_TEXT_LIMIT) : '';
    }
    return '';
  };
  const plain = toPlainValue(value);
  if (Array.isArray(plain)) {
    const items = plain.map(asText).filter(Boolean).slice(0, 500);
    return items.length ? items : undefined;
  }
  const text = asText(plain);
  return text ? text : undefined;
};

const coerceRelationValue = (value, allowMultiple) => {
  const normalizeEntry = (entry) => {
    if (typeof entry === 'string') {
      const id = entry.trim();
      return isUuid(id) ? { id, label: '' } : null;
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || !isUuid(id)) return null;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    return { id, label };
  };
  if (allowMultiple) {
    const entries = (Array.isArray(value) ? value : [value]).map(normalizeEntry).filter(Boolean);
    return entries.length ? entries : undefined;
  }
  return normalizeEntry(value) || undefined;
};

// The value a cell keeps, or undefined if it doesn't fit (or is empty). rules: { type, choiceValues, allowMultiple }
export const coerceCellValue = (rules, rawValue) => {
  const value = toPlainValue(rawValue);
  if (value === null || value === undefined) return undefined;
  switch (rules.type) {
    case 'NUMBER': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const num = Number(trimmed);
        return Number.isFinite(num) ? num : undefined;
      }
      return undefined;
    }
    case 'CHECKBOX': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        if (!trimmed) return undefined;
        if (TRUE_STRINGS.has(trimmed)) return true;
        if (FALSE_STRINGS.has(trimmed)) return false;
        return true;
      }
      return undefined;
    }
    case 'DATE': {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        return Number.isNaN(Date.parse(trimmed)) ? undefined : trimmed;
      }
      return undefined;
    }
    case 'SELECT': {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      if (rules.choiceValues && !rules.choiceValues.includes(trimmed)) return undefined;
      return trimmed;
    }
    case 'MULTI_SELECT': {
      let values = [];
      if (Array.isArray(value)) {
        values = value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
      } else if (typeof value === 'string') {
        values = value.split(',').map((item) => item.trim()).filter(Boolean);
      } else {
        return undefined;
      }
      if (rules.choiceValues) values = values.filter((item) => rules.choiceValues.includes(item));
      return values.length ? values : undefined;
    }
    case 'RELATION': {
      if (rules.allowMultiple === null || rules.allowMultiple === undefined) return undefined;
      return coerceRelationValue(value, rules.allowMultiple);
    }
    default: {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      }
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
      return undefined;
    }
  }
};

// The rules for a column as the web app holds it
export const cellRulesFor = (field) => {
  const choices = Array.isArray(field?.options?.choices) ? field.options.choices.map(normalizeChoice).filter(Boolean) : null;
  const relation = field?.type === 'RELATION' ? getRelationConfig(field) : null;
  return {
    type: field?.type,
    choiceValues: choices ? choices.map((choice) => choice.value) : null,
    allowMultiple: relation ? relation.allowMultiple === true : null,
  };
};

const isEmptyValue = (value) =>
  value === null || value === undefined || value === false || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);

// A relation's entries as their labels, so they read as text in the new type
const asLabels = (value) => {
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === 'object' ? item.label || '' : item));
  if (value && typeof value === 'object') return value.label || '';
  return value;
};

// What a value turns into for a column of the new type; stricter than coerceCellValue, which also
// takes what people type: "maybe" doesn't become a ticked box, nor "5" a date in 2001.
const prepareForType = (type, value) => {
  switch (type) {
    case 'TEXT':
    case 'URL':
      if (Array.isArray(value)) return asLabels(value).filter(Boolean).join(', ');
      if (value === true) return 'Yes';
      return asLabels(value);
    case 'NUMBER':
      if (Array.isArray(value) && value.length === 1) return asLabels(value[0]);
      return typeof value === 'boolean' ? undefined : asLabels(value);
    case 'CHECKBOX':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const trimmed = value.trim().toLowerCase();
        return TRUE_STRINGS.has(trimmed) ? true : FALSE_STRINGS.has(trimmed) ? false : undefined;
      }
      return typeof value === 'number' ? value !== 0 : undefined;
    case 'DATE': {
      const text = Array.isArray(value) && value.length === 1 ? asLabels(value[0]) : asLabels(value);
      return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}/.test(text.trim()) ? text : undefined;
    }
    case 'SELECT': {
      const single = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
      const text = asLabels(single);
      if (typeof text === 'number') return String(text);
      return typeof text === 'string' && !text.includes(',') ? text : undefined;
    }
    case 'MULTI_SELECT': {
      const list = Array.isArray(value) ? asLabels(value) : asLabels(value);
      if (typeof list === 'number') return [String(list)];
      return list;
    }
    case 'RELATION':
      return value;
    default:
      return undefined;
  }
};

/**
 * Plans changing a column from one type to another: for each row, the new value and anything
 * kept because it doesn't fit, plus the new type's options (a select gets a choice for each
 * value it takes in). A value kept from an earlier type change is tried again, so changing
 * back brings it back.
 */
export const planTypeChange = (rows, field, nextType, nextOptions = {}) => {
  const isSelect = nextType === 'SELECT' || nextType === 'MULTI_SELECT';
  const existingChoices = isSelect && Array.isArray(nextOptions.choices) ? nextOptions.choices.map(normalizeChoice).filter(Boolean) : [];
  // Values become choices, so any value fits a select here
  const rules = { ...cellRulesFor({ type: nextType, options: nextOptions }), ...(isSelect ? { choiceValues: null } : {}) };
  const keptKey = keptValueKey(field.id);
  const choiceValues = new Set(existingChoices.map((choice) => choice.value));
  const addedChoices = [];
  const cells = [];
  let keptCount = 0;
  (rows || []).forEach((row) => {
    if (!row?.id) return;
    const current = toPlainValue(row.data?.[field.id]);
    const previouslyKept = toPlainValue(row.data?.[keptKey]);
    const source = isEmptyValue(current) ? previouslyKept : current;
    if (isEmptyValue(source)) {
      if (current !== undefined || previouslyKept !== undefined) cells.push({ rowId: row.id, value: undefined, kept: undefined });
      return;
    }
    const prepared = nextType === 'LINKED_FROM' ? undefined : prepareForType(nextType, source);
    const value = prepared === undefined ? undefined : coerceCellValue(rules, prepared);
    if (value !== undefined) {
      if (isSelect) {
        (Array.isArray(value) ? value : [value]).forEach((choice) => {
          if (choiceValues.has(choice)) return;
          choiceValues.add(choice);
          addedChoices.push({ value: choice, color: null });
        });
      }
      cells.push({ rowId: row.id, value, kept: undefined });
      return;
    }
    keptCount += 1;
    cells.push({ rowId: row.id, value: undefined, kept: normalizeKeptValue(source) });
  });
  const options = isSelect ? { ...nextOptions, choices: [...existingChoices, ...addedChoices] } : nextOptions;
  return { cells, keptCount, options };
};

// What's shown in a cell that holds nothing that fits its column: the value kept from before its
// type changed, or (from before values were kept) one left in the cell that doesn't fit
export const keptValueFor = (row, field) => {
  if (!row?.data || !field?.id) return undefined;
  const kept = normalizeKeptValue(row.data[keptValueKey(field.id)]);
  if (kept !== undefined) return kept;
  if (!['NUMBER', 'DATE', 'CHECKBOX'].includes(field.type)) return undefined;
  const raw = row.data[field.id];
  if (isEmptyValue(toPlainValue(raw))) return undefined;
  return coerceCellValue(cellRulesFor(field), raw) === undefined ? normalizeKeptValue(raw) : undefined;
};

export const keptValueText = (kept) => (Array.isArray(kept) ? kept.join(', ') : kept || '');

const TYPE_NOUNS = {
  NUMBER: 'a number',
  DATE: 'a date',
  CHECKBOX: 'yes or no',
  SELECT: 'one of the choices',
  MULTI_SELECT: 'one of the choices',
  RELATION: 'a linked row',
  LINKED_FROM: 'shown in a Linked from column',
  URL: 'a link',
  TEXT: 'text',
};
export const notFitText = (type) => (type === 'LINKED_FROM' ? "Can't be shown in a Linked from column" : `Not ${TYPE_NOUNS[type] || 'valid here'}`);
