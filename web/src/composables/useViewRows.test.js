import { describe, it, expect } from 'vitest';
import { ref, computed } from 'vue';
import { useViewRows } from './useViewRows';

// A view's filters over a few rows: a name, a number and a select column
const fields = [
  { id: 'name', type: 'TEXT', name: 'Name' },
  { id: 'count', type: 'NUMBER', name: 'Count' },
  { id: 'status', type: 'SELECT', name: 'Status' },
];
const rows = [
  { id: 'a', data: { name: 'Apples', count: 5, status: 'To do' } },
  { id: 'b', data: { name: 'Blank' } },
  { id: 'c', data: { name: 'Cold', count: -1, status: 'Doing' } },
  { id: 'z', data: { name: 'Zero', count: 0, status: 'Done' } },
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

  it('match a select that is any of, or none of, several choices', () => {
    expect(shown([{ fieldId: 'status', operator: 'is_any_of', value: ['To do', 'done'] }])).toEqual(['a', 'z']);
    // An empty cell isn't any of them
    expect(shown([{ fieldId: 'status', operator: 'is_none_of', value: ['To do', 'Done'] }])).toEqual(['b', 'c']);
    // One choice given as it was for "is" (the operator changed): the same
    expect(shown([{ fieldId: 'status', operator: 'is_any_of', value: 'Doing' }])).toEqual(['c']);
    // None picked yet: no filter, as with any rule still waiting for its value
    expect(shown([{ fieldId: 'status', operator: 'is_any_of', value: [] }])).toEqual(['a', 'b', 'c', 'z']);
    expect(shown([{ fieldId: 'status', operator: 'is_none_of', value: ['', ' '] }])).toEqual(['a', 'b', 'c', 'z']);
    // ...and doesn't undo the others in a "match any" view
    const { viewFilteredRows } = useViewRows({
      fields: ref(fields),
      fieldById: computed(() => new Map(fields.map((f) => [f.id, f]))),
      tableRows: ref(rows),
      activeSavedView: ref({ config: { filters: { match: 'OR', rules: [{ fieldId: 'status', operator: 'is_any_of', value: [] }, { fieldId: 'name', operator: 'is', value: 'Cold' }] } } }),
      displayValueForField: (row, field) => row.data[field.id] ?? '',
    });
    expect(viewFilteredRows.value.map((row) => row.id)).toEqual(['c']);
  });

  it('match "any of" whatever the capitals, and against each of a cell\'s values once the column takes several', () => {
    expect(shown([{ fieldId: 'status', operator: 'is_any_of', value: ['DOING', null] }])).toEqual(['c']);
    const tagged = [{ id: 'tags', type: 'MULTI_SELECT', name: 'Tags' }];
    const { viewFilteredRows } = useViewRows({
      fields: ref(tagged),
      fieldById: computed(() => new Map(tagged.map((f) => [f.id, f]))),
      tableRows: ref([{ id: 'p', data: { tags: ['Red', 'Blue'] } }, { id: 'q', data: { tags: ['Green'] } }, { id: 'r', data: {} }]),
      activeSavedView: ref({ config: { filters: { match: 'AND', rules: [{ fieldId: 'tags', operator: 'is_none_of', value: ['Blue'] }] } } }),
      displayValueForField: (row, field) => row.data[field.id] ?? '',
    });
    expect(viewFilteredRows.value.map((row) => row.id)).toEqual(['q', 'r']);
  });
});
