// Only the type is imported: these rules run without the generated Prisma client (in the unit tests)
import type { DatabaseFieldType } from '@prisma/client';
import { isUuid } from './uuid.util';
import { TRUE_STRINGS, FALSE_STRINGS } from './boolean-strings.const';

// The values a database cell of each type holds. The web app has a copy of these rules
// (web/src/utils/database/cellValues.js), and both are tested against the same examples in
// api/test/fixtures/cell-values.json, so a value the browser writes is one the server keeps.

// A value that didn't fit its column when the column's type changed, kept under this key per
// column so changing the type back brings it back.
export const KEPT_VALUE_PREFIX = '__kept:';
export const keptValueKey = (fieldId: string) => `${KEPT_VALUE_PREFIX}${fieldId}`;
const KEPT_TEXT_LIMIT = 10_000;

// A kept value as plain text, or a list of text: what the cell showed before.
export const normalizeKeptValue = (value: unknown): string | string[] | undefined => {
  const asText = (item: unknown) => {
    if (typeof item === 'string') return item.trim().slice(0, KEPT_TEXT_LIMIT);
    if (typeof item === 'number' && Number.isFinite(item)) return String(item);
    if (typeof item === 'boolean') return item ? 'Yes' : '';
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const label = (item as any).label || (item as any).id;
      return typeof label === 'string' ? label.trim().slice(0, KEPT_TEXT_LIMIT) : '';
    }
    return '';
  };
  if (Array.isArray(value)) {
    const items = value.map(asText).filter(Boolean).slice(0, 500);
    return items.length ? items : undefined;
  }
  const text = asText(value);
  return text ? text : undefined;
};

export type CellValueRules = {
  type: DatabaseFieldType;
  // The choices a select may hold, or null for any
  choiceValues?: string[] | null;
  // For a relation: whether it links to several rows, or null if it isn't set up.
  // For a person column: whether it holds several people.
  allowMultiple?: boolean | null;
};

export const coerceRelationValue = (value: any, allowMultiple: boolean) => {
  const normalizeEntry = (entry: any) => {
    if (typeof entry === 'string') {
      const id = entry.trim();
      if (!isUuid(id)) return null;
      return { id, label: '' };
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!rawId || !isUuid(rawId)) return null;
    const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
    return { id: rawId, label: rawLabel };
  };
  if (allowMultiple) {
    const list = Array.isArray(value) ? value : [value];
    const entries = list.map((entry) => normalizeEntry(entry)).filter(Boolean) as Array<{ id: string; label: string }>;
    return entries.length ? entries : undefined;
  }
  const entry = normalizeEntry(value);
  return entry || undefined;
};

// The value a cell keeps, or undefined if it doesn't fit the column (or is empty).
export const coerceCellValue = (rules: CellValueRules, value: any): any => {
  if (value === null || value === undefined) return undefined;
  switch (rules.type) {
    case 'NUMBER': {
      if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
      }
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
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const parsed = Date.parse(trimmed);
        return Number.isNaN(parsed) ? undefined : trimmed;
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
      let values: string[] = [];
      if (Array.isArray(value)) {
        values = value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
      } else if (typeof value === 'string') {
        values = value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      } else {
        return undefined;
      }
      if (rules.choiceValues) {
        values = values.filter((item) => rules.choiceValues?.includes(item));
      }
      if (!values.length) return undefined;
      return values;
    }
    case 'PERSON': {
      // User ids, as a list even when the column holds one person
      const list = Array.isArray(value) ? value : [value];
      const ids = [...new Set(list.filter((item) => typeof item === 'string' && isUuid(item.trim())).map((item) => item.trim()))];
      if (!ids.length) return undefined;
      return rules.allowMultiple === true ? ids : ids.slice(0, 1);
    }
    case 'RELATION': {
      if (rules.allowMultiple === null || rules.allowMultiple === undefined) return undefined;
      return coerceRelationValue(value, rules.allowMultiple);
    }
    case 'URL':
    case 'TEXT':
    default: {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
      }
      if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : undefined;
      }
      return undefined;
    }
  }
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * For writers that would rather hear about a value that doesn't fit than have it kept aside (the
 * MCP server): the value to save, with a choice matched whatever its case, or what the column
 * takes. Empty clears the cell. Stricter than coerceCellValue: "maybe" isn't a checkbox's true, and
 * a date is YYYY-MM-DD, never a guess at 03/04.
 */
export const checkCellValue = (rules: CellValueRules, value: any): { value: any } | { problem: string } => {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return { value: null };
  const choice = (item: unknown) => {
    if (typeof item !== 'string') return undefined;
    const text = item.trim();
    if (!rules.choiceValues) return text || undefined;
    return rules.choiceValues.find((c) => c === text) ?? rules.choiceValues.find((c) => c.toLowerCase() === text.toLowerCase());
  };
  const choices = () => (rules.choiceValues?.length ? `one of: ${rules.choiceValues.join(', ')}` : 'one of its choices (it has none yet)');
  switch (rules.type) {
    case 'NUMBER': {
      const num = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN;
      return Number.isFinite(num) ? { value: num } : { problem: 'a number' };
    }
    case 'CHECKBOX': {
      if (typeof value === 'boolean') return { value };
      const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
      if (TRUE_STRINGS.has(text)) return { value: true };
      if (FALSE_STRINGS.has(text)) return { value: false };
      return { problem: 'true or false' };
    }
    case 'DATE': {
      const text = typeof value === 'string' ? value.trim() : '';
      return ISO_DATE.test(text) && !Number.isNaN(Date.parse(text)) ? { value: text } : { problem: 'a date as YYYY-MM-DD' };
    }
    case 'SELECT': {
      const match = choice(value);
      return match ? { value: match } : { problem: choices() };
    }
    case 'MULTI_SELECT': {
      const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [value];
      const matched = items.map(choice);
      return matched.every(Boolean) ? { value: [...new Set(matched)] } : { problem: `a list, each ${choices()}` };
    }
    case 'PERSON': {
      const list = Array.isArray(value) ? value : [value];
      if (!list.every((item) => typeof item === 'string' && isUuid(item.trim()))) return { problem: "people's user ids" };
      return { value: [...new Set(list.map((item: string) => item.trim()))] };
    }
    case 'RELATION': {
      // Every entry a row id, not just some of them
      const multiple = rules.allowMultiple !== false;
      const coerced = coerceRelationValue(value, multiple);
      const given = Array.isArray(value) ? value.length : 1;
      const kept = Array.isArray(coerced) ? coerced.length : coerced ? 1 : 0;
      if (!kept || kept !== given || (!multiple && Array.isArray(value) && value.length > 1)) return { problem: 'row ids from the linked database' };
      return { value: coerced };
    }
    default:
      return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? { value } : { problem: 'text' };
  }
};

/**
 * A row's cells as they're saved: each value that fits its column, and beside it what doesn't
 * fit, a value kept when the column's type changed or one left in the cell, rather than losing it.
 */
export const sanitizeRowCells = (columns: Array<CellValueRules & { id: string }>, rawData: Record<string, any>) => {
  const cells: Record<string, any> = {};
  columns.forEach((column) => {
    const next = column.id in rawData ? coerceCellValue(column, rawData[column.id]) : undefined;
    if (next !== undefined) {
      cells[column.id] = next;
      return;
    }
    const kept = normalizeKeptValue(rawData[keptValueKey(column.id)]) ?? normalizeKeptValue(rawData[column.id]);
    if (kept !== undefined) cells[keptValueKey(column.id)] = kept;
  });
  return cells;
};
