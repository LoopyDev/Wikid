import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  getMultiSelectValues,
  getMultiSelectValuesFromRaw,
  getRelationEntries,
  normalizeCellValue,
  normalizeFilterValues,
  shouldClearCell,
  stringifyValue,
  valueForField,
} from './cellValues';

const field = (type, extra = {}) => ({ id: 'f1', type, ...extra });
const row = (value) => ({ id: 'r1', data: { f1: value } });

describe('normalizeCellValue', () => {
  it('turns typed text into the value for each field type', () => {
    expect(normalizeCellValue(field('NUMBER'), ' 42 ')).toBe(42);
    expect(normalizeCellValue(field('NUMBER'), 'abc')).toBeNull();
    expect(normalizeCellValue(field('CHECKBOX'), 'Yes')).toBe(true);
    expect(normalizeCellValue(field('CHECKBOX'), '0')).toBe(false);
    expect(normalizeCellValue(field('URL'), ' https://a.b ')).toBe('https://a.b');
    expect(normalizeCellValue(field('MULTI_SELECT'), 'a, b,, c')).toEqual(['a', 'b', 'c']);
    expect(normalizeCellValue(field('MULTI_SELECT'), [' a ', ''])).toEqual(['a']);
  });

  it('keeps text as typed, and treats empty input as no value', () => {
    expect(normalizeCellValue(field('TEXT'), '  padded  ')).toBe('  padded  ');
    for (const type of ['TEXT', 'NUMBER', 'CHECKBOX', 'URL', 'MULTI_SELECT']) {
      expect(normalizeCellValue(field(type), '   ')).toBeNull();
    }
  });
});

describe('stringifyValue', () => {
  it('shows labels for relations and joins lists', () => {
    expect(stringifyValue([{ id: 'x', label: 'Ada' }, { id: 'y', label: '' }])).toBe('Ada, y');
    expect(stringifyValue(['a', null, 'b'])).toBe('a, b');
    expect(stringifyValue(7)).toBe('7');
    expect(stringifyValue(null)).toBe('');
  });

  it('reads live-editing (Yjs) values too', () => {
    const doc = new Y.Doc();
    const list = doc.getArray('list');
    const entry = new Y.Map();
    list.push([entry]);
    entry.set('id', 'r9');
    entry.set('label', 'Linked row');
    expect(stringifyValue(list)).toBe('Linked row');
  });
});

describe('relations and multi-select values', () => {
  it('reads relation entries in their different stored shapes', () => {
    expect(getRelationEntries(row('id-1'), field('RELATION'))).toEqual([{ id: 'id-1', label: '' }]);
    expect(getRelationEntries(row([{ id: ' id-2 ', label: ' Two ' }, { label: 'no id' }]), field('RELATION'))).toEqual([
      { id: 'id-2', label: 'Two' },
    ]);
    expect(getRelationEntries(row(null), field('RELATION'))).toEqual([]);
  });

  it('reads multi-select values from arrays and comma-separated text', () => {
    expect(getMultiSelectValues(row(['a', ' b ']), field('MULTI_SELECT'))).toEqual(['a', 'b']);
    expect(getMultiSelectValues(row('a, b'), field('MULTI_SELECT'))).toEqual(['a', 'b']);
    expect(getMultiSelectValuesFromRaw(42)).toEqual([]);
  });

  it('lists related ids only for relations that allow several', () => {
    const single = field('RELATION', { options: { relation: { pageId: 'p' } } });
    const multi = field('RELATION', { options: { relation: { pageId: 'p', allowMultiple: true } } });
    const value = row([{ id: 'a' }, { id: 'b' }]);
    expect(getMultiSelectValues(value, single)).toEqual([]);
    expect(getMultiSelectValues(value, multi)).toEqual(['a', 'b']);
  });

  it('gives the editable text for a cell', () => {
    expect(valueForField(row([{ id: 'a' }]), field('RELATION'))).toBe('a');
    expect(valueForField(row(['x', 'y']), field('MULTI_SELECT'))).toBe('x, y');
    expect(valueForField(row(undefined), field('TEXT'))).toBe('');
  });
});

describe('small helpers', () => {
  it('normalizes filter values', () => {
    expect(normalizeFilterValues([' a ', '', 'b'])).toEqual(['a', 'b']);
    expect(normalizeFilterValues({ id: ' r1 ' })).toEqual(['r1']);
    expect(normalizeFilterValues(null)).toEqual([]);
    expect(normalizeFilterValues(3)).toEqual(['3']);
  });

  it('knows when a cell should be cleared', () => {
    expect(shouldClearCell(null)).toBe(true);
    expect(shouldClearCell('')).toBe(true);
    expect(shouldClearCell([])).toBe(true);
    expect(shouldClearCell(0)).toBe(false);
    expect(shouldClearCell(false)).toBe(false);
  });
});
