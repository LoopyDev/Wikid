import type { DatabaseFieldType } from '@prisma/client';
import { FALSE_STRINGS, TRUE_STRINGS } from './boolean-strings.const';
import { coerceCellValue, keptValueKey, normalizeKeptValue, type CellValueRules } from './cell-values.util';

// Changing a column: what each cell becomes when its type changes, or when its choices are
// renamed or removed, and what's kept beside it when it no longer fits. The web app's own copy
// (web/src/utils/database/typeChange.js, choiceChange.js) works on the live document; both are
// checked against api/test/fixtures/column-changes.json.

type Choice = { value: string; label?: string | null; color: string | null };
type Field = { id: string; type: DatabaseFieldType | string; options?: any };
type Row = { id: string; data?: Record<string, any> | null };
type Person = { id: string; name?: string | null };

/** A cell's new value and what's kept beside it; undefined for none. */
export type CellChange = { rowId: string; value: any; kept: string | string[] | undefined };

const normalizeChoice = (choice: any): Choice | null => {
  if (typeof choice === 'string') {
    const value = choice.trim();
    return value ? { value, color: null } : null;
  }
  if (choice && typeof choice === 'object') {
    const value = typeof choice.value === 'string' ? choice.value.trim() : '';
    if (!value) return null;
    const label = typeof choice.label === 'string' ? choice.label.trim() : '';
    const color = typeof choice.color === 'string' && choice.color.trim() ? choice.color.trim() : null;
    return { value, label: label || null, color };
  }
  return null;
};

const optionsOf = (field: Field): Record<string, any> =>
  field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};

const isPeopleField = (field: Field) => field?.type === 'PERSON' || optionsOf(field).source === 'members';

/** The rules for what a cell of a column keeps. */
export const cellRulesFor = (field: Field): CellValueRules => {
  const options = optionsOf(field);
  const choices = Array.isArray(options.choices) ? options.choices.map(normalizeChoice).filter(Boolean) as Choice[] : null;
  const relation = field?.type === 'RELATION' && options.relation && typeof options.relation === 'object' && typeof options.relation.pageId === 'string' && options.relation.pageId.trim()
    ? options.relation
    : null;
  return {
    type: field?.type as DatabaseFieldType,
    choiceValues: choices ? choices.map((choice) => choice.value) : null,
    allowMultiple: field?.type === 'PERSON' ? options.allowMultiple === true : relation ? relation.allowMultiple === true : null,
  };
};

const isEmptyValue = (value: any) =>
  value === null || value === undefined || value === false || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);

// A relation's entries as their labels, so they read as text in the new type
const asLabels = (value: any): any => {
  if (Array.isArray(value)) return value.map((item) => (item && typeof item === 'object' ? item.label || '' : item));
  if (value && typeof value === 'object') return value.label || '';
  return value;
};

// What a value turns into for a column of the new type; stricter than coerceCellValue, which also
// takes what people type: "maybe" doesn't become a ticked box, nor "5" a date in 2001.
const prepareForType = (type: string, value: any): any => {
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
      const list = asLabels(value);
      if (typeof list === 'number') return [String(list)];
      return list;
    }
    case 'RELATION':
    case 'PERSON':
      return value;
    default:
      return undefined;
  }
};

// Names to the members they name (all of them, or nothing): for turning text into people
const peopleNamed = (value: any, people: Person[]) => {
  const byName = new Map(people.map((person) => [String(person.name || '').trim().toLowerCase(), person.id]));
  const names = (Array.isArray(value) ? value : String(value ?? '').split(',')).map((name) => String(name).trim()).filter(Boolean);
  const ids = names.map((name) => byName.get(name.toLowerCase()));
  return names.length && ids.every(Boolean) ? (ids as string[]) : undefined;
};

/**
 * Plans changing a column from one type to another: for each row, the new value and anything
 * kept because it doesn't fit, plus the new type's options (a select gets a choice for each
 * value it takes in). A value kept from an earlier type change is tried again, so changing back
 * brings it back.
 */
export const planTypeChange = (
  rows: Row[],
  field: Field,
  nextType: string,
  nextOptions: Record<string, any> = {},
  { people = [] }: { people?: Person[] } = {}
) => {
  const fromPeople = isPeopleField(field);
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const isSelect = nextType === 'SELECT' || nextType === 'MULTI_SELECT';
  const existingChoices = isSelect && Array.isArray(nextOptions.choices) ? (nextOptions.choices.map(normalizeChoice).filter(Boolean) as Choice[]) : [];
  // Values become choices, so any value fits a select here
  const rules: CellValueRules = { ...cellRulesFor({ id: field.id, type: nextType, options: nextOptions }), ...(isSelect ? { choiceValues: null } : {}) };
  const keptKey = keptValueKey(field.id);
  const choiceValues = new Set(existingChoices.map((choice) => choice.value));
  const addedChoices: Choice[] = [];
  const cells: CellChange[] = [];
  let keptCount = 0;
  for (const row of rows || []) {
    if (!row?.id) continue;
    const current = row.data?.[field.id];
    const previouslyKept = row.data?.[keptKey];
    const source = isEmptyValue(current) ? previouslyKept : current;
    if (isEmptyValue(source)) {
      if (current !== undefined || previouslyKept !== undefined) cells.push({ rowId: row.id, value: undefined, kept: undefined });
      continue;
    }
    // People are their names in other types; text names people when every name is a member's
    const asSource =
      fromPeople && nextType !== 'PERSON'
        ? (Array.isArray(source) ? source : [source]).map((id) => nameOf.get(id) || '').filter(Boolean)
        : source;
    const prepared =
      nextType === 'LINKED_FROM'
        ? undefined
        : nextType === 'PERSON' && !fromPeople
          ? peopleNamed(asLabels(source), people)
          : prepareForType(nextType, asSource);
    // Several people don't fit a one-person column: kept, rather than cut down to the first
    if (nextType === 'PERSON' && Array.isArray(prepared) && prepared.length > 1 && nextOptions.allowMultiple !== true) {
      keptCount += 1;
      cells.push({ rowId: row.id, value: undefined, kept: normalizeKeptValue(fromPeople ? source.map((id: string) => nameOf.get(id) || id) : source) });
      continue;
    }
    const value = prepared === undefined ? undefined : coerceCellValue(rules, prepared);
    if (value !== undefined) {
      if (isSelect) {
        for (const choice of Array.isArray(value) ? value : [value]) {
          if (choiceValues.has(choice)) continue;
          choiceValues.add(choice);
          addedChoices.push({ value: choice, color: null });
        }
      }
      cells.push({ rowId: row.id, value, kept: undefined });
      continue;
    }
    keptCount += 1;
    cells.push({ rowId: row.id, value: undefined, kept: normalizeKeptValue(asSource) });
  }
  const options = isSelect ? { ...nextOptions, choices: [...existingChoices, ...addedChoices] } : nextOptions;
  return { cells, keptCount, options };
};

const multiSelectValues = (value: any): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
};

/**
 * What a select's cell becomes when the column's choices change: a renamed choice follows its new
 * name; one no longer a choice is kept aside (shown greyed until replaced, as after a type change)
 * rather than lost; and a kept one that's a choice again comes back. Null if nothing changes.
 *
 * raw: the cell's value, kept: what's kept for it, allowed: the choices now, renames: old name to new.
 */
export const settleChoiceCell = (
  type: string,
  raw: any,
  kept: any,
  allowed: Set<string>,
  renames: Map<string, string>
): { value: any; kept: string | string[] | undefined } | null => {
  const rename = (choice: string) => renames.get(choice) ?? choice;
  const keptList = (Array.isArray(kept) ? kept : typeof kept === 'string' && kept ? [kept] : []).map(String);
  if (type === 'SELECT') {
    const current = typeof raw === 'string' ? raw.trim() : '';
    const keptNow = keptList.length === 1 ? rename(keptList[0]) : null;
    if (!current) {
      // Kept, and a choice again: back as the value
      return keptNow && allowed.has(keptNow) ? { value: keptNow, kept: undefined } : null;
    }
    const next = rename(current);
    if (allowed.has(next)) return next === current ? null : { value: next, kept: keptNow ?? (kept || undefined) };
    return { value: undefined, kept: current };
  }
  const values = multiSelectValues(raw);
  const all = [...new Set([...values, ...keptList].map(rename))];
  const value = all.filter((choice) => allowed.has(choice));
  const stillKept = all.filter((choice) => !allowed.has(choice));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);
  if (same(value, values) && same(stillKept, keptList)) return null;
  return { value: value.length ? value : undefined, kept: stillKept.length ? stillKept : undefined };
};

/** The cells of a select or multi-select whose choices change: renamed ones followed, removed ones kept aside. */
export const planChoiceChange = (rows: Row[], field: Field, nextChoices: any[], renames: Map<string, string>) => {
  const allowed = new Set((nextChoices.map(normalizeChoice).filter(Boolean) as Choice[]).map((choice) => choice.value));
  const keptKey = keptValueKey(field.id);
  const cells: CellChange[] = [];
  let keptCount = 0;
  for (const row of rows || []) {
    if (!row?.id) continue;
    const settled = settleChoiceCell(String(field.type), row.data?.[field.id], row.data?.[keptKey], allowed, renames);
    if (!settled) continue;
    if (settled.kept !== undefined) keptCount += 1;
    cells.push({ rowId: row.id, ...settled });
  }
  return { cells, keptCount };
};
