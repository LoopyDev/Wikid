import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { coerceCellValue, keptValueFor, keptValueKey, planTypeChange } from './typeChange';
// The same examples the API's rules are checked against
import fixture from '../../../../api/test/fixtures/cell-values.json';

const ZONE = '11111111-1111-4111-8111-111111111111';

describe('the values a cell of each type keeps', () => {
  it('match the server (the shared examples)', () => {
    for (const { type, value, expected, ...rules } of fixture.cases) {
      expect(coerceCellValue({ type, ...rules }, value) ?? null, `${type} ${JSON.stringify(value)}`).toEqual(expected);
    }
  });

  it('reads values from the live document the same way', () => {
    const doc = new Y.Doc();
    const list = doc.getArray('list');
    list.push(['a', 'b']);
    expect(coerceCellValue({ type: 'MULTI_SELECT', choiceValues: null }, list)).toEqual(['a', 'b']);
  });
});

describe('changing a column type', () => {
  const field = { id: 'f1', type: 'TEXT', options: {} };
  const rows = (...values) => values.map((value, idx) => ({ id: `r${idx}`, data: value === undefined ? {} : { f1: value } }));
  const byRow = (plan) => Object.fromEntries(plan.cells.map((cell) => [cell.rowId, cell.kept !== undefined ? { kept: cell.kept } : cell.value]));

  it('converts what fits and keeps the rest', () => {
    const plan = planTypeChange(rows('12', ' 3.5 ', 'about ten', undefined), field, 'NUMBER');
    expect(byRow(plan)).toEqual({ r0: 12, r1: 3.5, r2: { kept: 'about ten' } });
    expect(plan.keptCount).toBe(1);
  });

  it("is stricter than what people type: 'maybe' isn't ticked, nor '5' a date", () => {
    expect(byRow(planTypeChange(rows('yes', 'No', 'maybe'), field, 'CHECKBOX'))).toEqual({ r0: true, r1: false, r2: { kept: 'maybe' } });
    expect(byRow(planTypeChange(rows('2026-10-29', '5', 'next Tuesday'), field, 'DATE'))).toEqual({
      r0: '2026-10-29',
      r1: { kept: '5' },
      r2: { kept: 'next Tuesday' },
    });
  });

  it('brings kept values back when the type changes back', () => {
    const numberField = { id: 'f1', type: 'NUMBER', options: {} };
    const plan = planTypeChange([{ id: 'r0', data: { [keptValueKey('f1')]: 'about ten' } }, { id: 'r1', data: { f1: 4 } }], numberField, 'TEXT');
    expect(byRow(plan)).toEqual({ r0: 'about ten', r1: '4' });
    expect(plan.keptCount).toBe(0);
  });

  it('gives a select a choice for each value it takes in', () => {
    const plan = planTypeChange(rows('Open', 'Closed', 'Open', 'a, b'), field, 'SELECT', { choices: [{ value: 'Closed', color: '#ff0000' }] });
    expect(byRow(plan)).toEqual({ r0: 'Open', r1: 'Closed', r2: 'Open', r3: { kept: 'a, b' } });
    expect(plan.options.choices).toEqual([{ value: 'Closed', label: null, color: '#ff0000' }, { value: 'Open', color: null }]);
    const multi = planTypeChange(rows('a, b'), field, 'MULTI_SELECT', { choices: [] });
    expect(byRow(multi)).toEqual({ r0: ['a', 'b'] });
    expect(multi.options.choices.map((choice) => choice.value)).toEqual(['a', 'b']);
  });

  it('turns relations and lists into text, and text into nothing a relation takes', () => {
    const relation = { id: 'f1', type: 'RELATION', options: { relation: { pageId: ZONE, allowMultiple: true } } };
    const linked = [{ id: ZONE, label: 'Zone A' }, { id: ZONE, label: 'Zone B' }];
    expect(byRow(planTypeChange(rows(linked), relation, 'TEXT'))).toEqual({ r0: 'Zone A, Zone B' });
    expect(byRow(planTypeChange(rows(linked), relation, 'MULTI_SELECT', { choices: [] }))).toEqual({ r0: ['Zone A', 'Zone B'] });
    expect(byRow(planTypeChange(rows('Zone A'), field, 'RELATION', { relation: { pageId: ZONE, allowMultiple: false } }))).toEqual({
      r0: { kept: 'Zone A' },
    });
  });

  it('shows a value as kept when it was kept, or sits in a cell it no longer fits', () => {
    const numberField = { id: 'f1', type: 'NUMBER', options: {} };
    expect(keptValueFor({ data: { [keptValueKey('f1')]: 'about ten' } }, numberField)).toBe('about ten');
    expect(keptValueFor({ data: { f1: 'about ten' } }, numberField)).toBe('about ten');
    expect(keptValueFor({ data: { f1: '12' } }, numberField)).toBeUndefined();
    expect(keptValueFor({ data: {} }, numberField)).toBeUndefined();
  });
});
