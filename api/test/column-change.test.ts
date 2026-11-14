import { describe, expect, it } from 'vitest';
import { planTypeChange, settleChoiceCell } from '../src/utils/column-change.util';
// The web app's rules are checked against the same examples
import fixture from './fixtures/column-changes.json';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

describe("what cells become when a column's type or choices change", () => {
  it('match the shared examples, for a type change', () => {
    for (const c of fixture.typeChanges as any[]) {
      expect(plain(planTypeChange(c.rows, c.field, c.nextType, c.nextOptions ?? {}, { people: fixture.people })), c.name).toEqual(c.expected);
    }
  });

  it('match the shared examples, for choices renamed or removed', () => {
    for (const c of fixture.choiceChanges as any[]) {
      expect(plain(settleChoiceCell(c.type, c.raw, c.kept, new Set(c.allowed), new Map(c.renames ?? []))), c.name).toEqual(c.expected);
    }
  });
});
