import { describe, it, expect } from 'vitest';
import { settleChoiceCell } from './choiceChange';
// The same examples the API's rules are checked against
import changes from '../../../../api/test/fixtures/column-changes.json';

const choices = (...values) => new Set(values);
const renames = (entries = []) => new Map(entries);

describe('settleChoiceCell', () => {
  it('matches the server (the shared examples)', () => {
    for (const c of changes.choiceChanges) {
      expect(JSON.parse(JSON.stringify(settleChoiceCell(c.type, c.raw, c.kept, new Set(c.allowed), new Map(c.renames ?? [])) ?? null)), c.name).toEqual(c.expected);
    }
  });

  it('a select follows its choice renamed', () => {
    expect(settleChoiceCell('SELECT', 'Open', undefined, choices('In progress', 'Done'), renames([['Open', 'In progress']]))).toEqual({ value: 'In progress', kept: undefined });
  });

  it('a select whose choice was removed keeps it aside, and gets it back if the choice comes back', () => {
    expect(settleChoiceCell('SELECT', 'Done', undefined, choices('Open'), renames())).toEqual({ value: undefined, kept: 'Done' });
    expect(settleChoiceCell('SELECT', undefined, 'Done', choices('Open', 'Done'), renames())).toEqual({ value: 'Done', kept: undefined });
    expect(settleChoiceCell('SELECT', 'Open', undefined, choices('Open'), renames())).toBeNull();
  });

  it('a multi-select renames, keeps aside and brings back each of its choices', () => {
    expect(settleChoiceCell('MULTI_SELECT', ['Red', 'Blue'], undefined, choices('Crimson'), renames([['Red', 'Crimson']]))).toEqual({ value: ['Crimson'], kept: ['Blue'] });
    expect(settleChoiceCell('MULTI_SELECT', ['Blue'], undefined, choices('Red'), renames())).toEqual({ value: undefined, kept: ['Blue'] });
    expect(settleChoiceCell('MULTI_SELECT', ['Red'], ['Blue'], choices('Red', 'Blue'), renames())).toEqual({ value: ['Red', 'Blue'], kept: undefined });
    expect(settleChoiceCell('MULTI_SELECT', ['Red'], undefined, choices('Red', 'Blue'), renames())).toBeNull();
  });
});
