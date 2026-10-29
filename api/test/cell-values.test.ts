import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { DatabaseFieldType } from '@prisma/client';
import { coerceCellValue, normalizeKeptValue } from '../src/utils/cell-values.util';
import { CollabMaterializerService } from '../src/collab/collab-materializer.service';
import fixture from './fixtures/cell-values.json';

describe('the values a cell of each type keeps', () => {
  it('match the shared examples (the web app checks the same ones)', () => {
    for (const { type, value, expected, ...rules } of fixture.cases as any[]) {
      const result = coerceCellValue({ type: type as DatabaseFieldType, ...rules }, value);
      expect(result ?? null, `${type} ${JSON.stringify(value)}`).toEqual(expected);
    }
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
    const materializer = new CollabMaterializerService(null as any) as any;
    const amount = { id: 'amount', type: DatabaseFieldType.NUMBER, normalizedOptions: { options: {}, choices: null, choiceValues: null } };
    const sanitize = (data: Record<string, any>) => materializer.sanitizeDatabaseRowData([amount], data);
    expect(sanitize({ amount: '12' })).toEqual({ amount: 12 });
    // Kept when the column's type changed
    expect(sanitize({ '__kept:amount': 'about ten' })).toEqual({ '__kept:amount': 'about ten' });
    // Left in the cell from before values were kept
    expect(sanitize({ amount: 'about ten' })).toEqual({ '__kept:amount': 'about ten' });
    // A value that fits wins; kept values of columns that are gone go
    expect(sanitize({ amount: 3, '__kept:amount': 'about ten' })).toEqual({ amount: 3 });
    expect(sanitize({ '__kept:gone': 'x' })).toEqual({});
  });
});
