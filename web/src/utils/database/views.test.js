import { describe, it, expect } from 'vitest';
import { normalizeViewConfig, normalizeViewType, operatorNeedsValue, operatorsForFieldType, sortByType, toComparableDate } from './views';

const sorted = (type, values) => [...values].sort((a, b) => sortByType(type, a, b));

describe('sortByType', () => {
  it('sorts numbers, dates and checkboxes by value', () => {
    expect(sorted('NUMBER', ['10', 2, '1'])).toEqual(['1', 2, '10']);
    expect(sorted('DATE', ['2026-03-01', '2025-12-31', '2026-01-15'])).toEqual(['2025-12-31', '2026-01-15', '2026-03-01']);
    expect(sorted('CHECKBOX', [true, false, true])).toEqual([false, true, true]);
  });

  it('sorts text ignoring case, using relation labels', () => {
    expect(sorted('TEXT', ['banana', 'Apple', 'cherry'])).toEqual(['Apple', 'banana', 'cherry']);
    expect(sorted('RELATION', [[{ id: '2', label: 'Zed' }], [{ id: '1', label: 'Amy' }]])).toEqual([
      [{ id: '1', label: 'Amy' }],
      [{ id: '2', label: 'Zed' }],
    ]);
  });

  it('puts empty values last', () => {
    expect(sorted('NUMBER', [null, 3, '', 1])).toEqual([1, 3, null, '']);
    expect(sorted('TEXT', ['', 'b', 'a'])).toEqual(['a', 'b', '']);
    expect(sorted('DATE', [null, '2026-01-01'])).toEqual(['2026-01-01', null]);
  });
});

describe('filters', () => {
  it('offers the operators that make sense for each field type', () => {
    expect(operatorsForFieldType('CHECKBOX')).toEqual(['is_checked', 'is_unchecked']);
    expect(operatorsForFieldType('NUMBER')).toContain('gte');
    expect(operatorsForFieldType('DATE')).toContain('on_or_before');
    expect(operatorsForFieldType('MULTI_SELECT')).toEqual(['contains', 'not_contains', 'is_empty', 'is_not_empty']);
    expect(operatorsForFieldType('TEXT')).toContain('contains');
  });

  it('knows which operators need a value', () => {
    expect(operatorNeedsValue('is')).toBe(true);
    expect(operatorNeedsValue('is_empty')).toBe(false);
    expect(operatorNeedsValue('is_checked')).toBe(false);
  });

  it('reads dates and timestamps for date filters', () => {
    expect(toComparableDate('2026-01-02')).toBe(Date.parse('2026-01-02'));
    expect(toComparableDate(1000)).toBe(1000);
    expect(toComparableDate('not a date')).toBeNull();
    expect(toComparableDate('')).toBeNull();
  });
});

describe('view settings', () => {
  it('accepts the known view types and falls back to a table', () => {
    expect(normalizeViewType(' board ')).toBe('BOARD');
    expect(normalizeViewType('calendar')).toBe('TABLE');
    expect(normalizeViewType(undefined)).toBe('TABLE');
  });

  it('cleans up stored view settings', () => {
    expect(
      normalizeViewConfig({
        filters: { match: 'OR', rules: [{ fieldId: 'f1', operator: 'is', value: 'x' }, { fieldId: 'f2' }, null] },
        sorts: [{ fieldId: 'f1', direction: 'desc' }, { fieldId: 'f2', direction: 'sideways' }, {}],
        hiddenFieldIds: ['f3', 4],
        groupFieldId: 'f1',
      }),
    ).toEqual({
      filters: { match: 'OR', rules: [{ fieldId: 'f1', operator: 'is', value: 'x' }] },
      sorts: [
        { fieldId: 'f1', direction: 'desc' },
        { fieldId: 'f2', direction: 'asc' },
      ],
      hiddenFieldIds: ['f3'],
      groupFieldId: 'f1',
      cardFieldId: null,
    });
  });

  it('gives empty defaults for missing settings', () => {
    expect(normalizeViewConfig(null)).toEqual({
      filters: { match: 'AND', rules: [] },
      sorts: [],
      hiddenFieldIds: [],
      groupFieldId: null,
      cardFieldId: null,
    });
  });
});
