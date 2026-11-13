import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { useViewRows } from './useViewRows';

// A view's filters over a few rows: a name and a number column
const fields = [{ id: 'name', type: 'TEXT', name: 'Name' }, { id: 'count', type: 'NUMBER', name: 'Count' }];
const rows = [
  { id: 'a', data: { name: 'Apples', count: 5 } },
  { id: 'b', data: { name: 'Blank' } },
  { id: 'c', data: { name: 'Cold', count: -1 } },
  { id: 'z', data: { name: 'Zero', count: 0 } },
];
const shown = (rules) => {
  const { viewFilteredRows } = useViewRows({
    fields: ref(fields),
    fieldById: computed(() => new Map(fields.map((f) => [f.id, f]))),
    tableRows: ref(rows),
    activeSavedView: ref({ config: { filters: { match: 'AND', rules } } }),
    displayValueForField: (row, field) => row.data[field.id] ?? '',
  });
  return viewFilteredRows.value.map((row) => row.id);
};

describe("a view's filters", () => {
  it('leave every row while a new rule has no value yet (it hid them all)', () => {
    expect(shown([{ fieldId: 'name', operator: 'is', value: '' }])).toEqual(['a', 'b', 'c', 'z']);
    expect(shown([{ fieldId: 'count', operator: 'lt', value: '' }])).toEqual(['a', 'b', 'c', 'z']);
  });

  it("don't count an empty number cell as 0", () => {
    expect(shown([{ fieldId: 'count', operator: 'lt', value: '1' }])).toEqual(['c', 'z']);
    expect(shown([{ fieldId: 'count', operator: 'is', value: '0' }])).toEqual(['z']);
    // It isn't any number, so "is not" keeps it; and "is empty" finds it
    expect(shown([{ fieldId: 'count', operator: 'is_not', value: '5' }])).toEqual(['b', 'c', 'z']);
    expect(shown([{ fieldId: 'count', operator: 'is_empty' }])).toEqual(['b']);
  });
});
