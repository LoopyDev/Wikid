import { describe, expect, it } from 'vitest';
import type { DatabaseFieldType } from '@prisma/client';
import { checkCellValue, coerceCellValue, normalizeKeptValue, sanitizeRowCells } from '../src/utils/cell-values.util';

// A plain unit test: no generated Prisma client (CI runs these without one), so types only
import fixture from './fixtures/cell-values.json';

describe('the values a cell of each type keeps', () => {
  it('match the shared examples (the web app checks the same ones)', () => {
    for (const { type, value, expected, ...rules } of fixture.cases as any[]) {
      const result = coerceCellValue({ type: type as DatabaseFieldType, ...rules }, value);
      expect(result ?? null, `${type} ${JSON.stringify(value)}`).toEqual(expected);
    }
  });

  it('takes a relation to one row given as a list of one, but not of two', () => {
    const row = '11111111-1111-4111-8111-111111111111';
    const one = { type: 'RELATION' as DatabaseFieldType, allowMultiple: false };
    expect(checkCellValue(one, [row])).toEqual({ value: { id: row, label: '' } });
    expect(checkCellValue(one, [row, row])).toHaveProperty('problem');
    expect(checkCellValue({ ...one, allowMultiple: true }, [row])).toEqual({ value: [{ id: row, label: '' }] });
  });

  it('keeps what a cell showed when it no longer fits, as text', () => {
    expect(normalizeKeptValue('about ten')).toBe('about ten');
    expect(normalizeKeptValue(12)).toBe('12');
    expect(normalizeKeptValue(['a', '', 'b'])).toEqual(['a', 'b']);
    expect(normalizeKeptValue({ id: 'x', label: 'Zone A' })).toBe('Zone A');
    expect(normalizeKeptValue('  ')).toBeUndefined();
    expect(normalizeKeptValue(false)).toBeUndefined();
  });

  it("saves the live document's rows keeping what doesn't fit beside the cell, not dropping it", () => {
    const sanitize = (data: Record<string, any>) =>
      sanitizeRowCells([{ id: 'amount', type: 'NUMBER' as DatabaseFieldType, choiceValues: null, allowMultiple: null }], data);
    expect(sanitize({ amount: '12' })).toEqual({ amount: 12 });
    // Kept when the column's type changed
    expect(sanitize({ '__kept:amount': 'about ten' })).toEqual({ '__kept:amount': 'about ten' });
    // Left in the cell from before values were kept
    expect(sanitize({ amount: 'about ten' })).toEqual({ '__kept:amount': 'about ten' });
    // Kept beside a value that fits, as the live document has it (a multi-select's removed choice
    // beside its other tags; the app takes it away when the cell is edited); kept values of columns
    // that are gone go
    expect(sanitize({ amount: 3, '__kept:amount': 'about ten' })).toEqual({ amount: 3, '__kept:amount': 'about ten' });
    expect(sanitize({ '__kept:gone': 'x' })).toEqual({});
  });
});
