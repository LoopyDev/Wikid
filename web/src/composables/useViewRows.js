import { computed } from 'vue';
import { isPageField, normalizeFieldOptions } from '../utils/database/fieldOptions';
import { getMultiSelectValues, stringifyValue, valueForField } from '../utils/database/cellValues';
import { toComparableDate } from '../utils/database/views';

// The rows a saved view shows: its filters and sort applied to the table's rows, and the board's
// columns and gallery's cards built from them. sortedRows gives them after the table's sort and
// search, which is the order every view shows.
export function useViewRows({ fields, fieldById, tableRows, activeSavedView, isBoardView, hiddenFieldIdSet, displayValueForField, getChoiceLabel, rowPageId, openRowPageOverlay, ensureRowPage, isReadonly, workspace, sortedRows }) {
  const matchesFilterRule = (row, rule) => {
    const field = fieldById.value.get(rule.fieldId);
    if (!field) return true;
    const { operator } = rule;
    const display = displayValueForField(row, field);
    const isEmpty =
      display == null || display === '' || (Array.isArray(display) && display.length === 0);
    if (operator === 'is_empty') return isEmpty;
    if (operator === 'is_not_empty') return !isEmpty;
    // A person column holding (or not holding) whoever is looking
    if (operator === 'is_me' || operator === 'is_not_me') {
      const ids = getMultiSelectValues(row, field).map(String);
      const mine = !!workspace?.activeUserId && ids.includes(workspace.activeUserId);
      return operator === 'is_me' ? mine : !mine;
    }

    if (field.type === 'CHECKBOX') {
      const raw = valueForField(row, field);
      const checked = raw === true || raw === 'true';
      if (operator === 'is_checked') return checked;
      if (operator === 'is_unchecked') return !checked;
      return true;
    }

    if (field.type === 'NUMBER') {
      const a = Number(valueForField(row, field));
      const b = Number(rule.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      switch (operator) {
        case 'is':
          return a === b;
        case 'is_not':
          return a !== b;
        case 'gt':
          return a > b;
        case 'gte':
          return a >= b;
        case 'lt':
          return a < b;
        case 'lte':
          return a <= b;
        default:
          return true;
      }
    }

    if (field.type === 'DATE') {
      const a = toComparableDate(valueForField(row, field));
      const b = toComparableDate(rule.value);
      if (a == null || b == null) return false;
      switch (operator) {
        case 'is':
          return a === b;
        case 'is_not':
          return a !== b;
        case 'before':
          return a < b;
        case 'after':
          return a > b;
        case 'on_or_before':
          return a <= b;
        case 'on_or_after':
          return a >= b;
        default:
          return true;
      }
    }

    if (field.type === 'MULTI_SELECT' || field.type === 'RELATION' || field.type === 'PERSON') {
      const values = (Array.isArray(display) ? display : [display]).map((v) => String(v ?? '').toLowerCase());
      const needle = String(rule.value ?? '').toLowerCase();
      if (!needle) return operator === 'not_contains';
      if (operator === 'contains') return values.some((v) => v.includes(needle));
      if (operator === 'not_contains') return !values.some((v) => v.includes(needle));
      return true;
    }

    // TEXT / URL / SELECT (compared against the displayed label)
    const hay = String(Array.isArray(display) ? display.join(' ') : display ?? '').toLowerCase();
    const needle = String(rule.value ?? '').toLowerCase();
    switch (operator) {
      case 'is':
        return hay === needle;
      case 'is_not':
        return hay !== needle;
      case 'contains':
        return hay.includes(needle);
      case 'not_contains':
        return !hay.includes(needle);
      default:
        return true;
    }
  };
  // Rows after applying the active saved view's filter rules. Built-in Table /
  // Audit views (no saved view active) pass through unchanged.
  const viewFilteredRows = computed(() => {
    const base = tableRows.value;
    const view = activeSavedView.value;
    const rules = (view?.config?.filters?.rules || []).filter((rule) => fieldById.value.has(rule.fieldId));
    if (!rules.length) return base;
    const mode = view.config.filters.match === 'OR' ? 'some' : 'every';
    return base.filter((row) => rules[mode]((rule) => matchesFilterRule(row, rule)));
  });
  // Sorting state for TanStack, derived from the active saved view's config.
  const viewSorting = computed(() =>
    (activeSavedView.value?.config?.sorts || [])
      .filter((sort) => fieldById.value.has(sort.fieldId))
      .map((sort) => ({ id: sort.fieldId, desc: sort.direction === 'desc' }))
  );
  const shownRows = computed(() => sortedRows());
  // --- Gallery / Board derived data ---
  const boardGroupField = computed(() => {
    const id = activeSavedView.value?.config?.groupFieldId;
    return id ? fieldById.value.get(id) || null : null;
  });
  const boardColumns = computed(() => {
    if (!isBoardView.value) return [];
    const field = boardGroupField.value;
    const rowsForBoard = shownRows.value;
    if (!field) {
      return [{ key: '__all__', label: 'All', rows: rowsForBoard }];
    }
    const choices = normalizeFieldOptions(field).choices;
    const groups = new Map();
    choices.forEach((choice) => groups.set(choice.value, []));
    const noneRows = [];
    rowsForBoard.forEach((row) => {
      const value = valueForField(row, field);
      if (value == null || value === '' || !groups.has(value)) {
        noneRows.push(row);
      } else {
        groups.get(value).push(row);
      }
    });
    const columns = choices.map((choice) => ({
      key: choice.value,
      label: getChoiceLabel(field, choice.value) || choice.value,
      rows: groups.get(choice.value) || [],
    }));
    columns.push({ key: '__none__', label: 'No value', rows: noneRows });
    return columns;
  });
  const galleryCardField = computed(() => {
    const id = activeSavedView.value?.config?.cardFieldId;
    return id ? fieldById.value.get(id) || null : null;
  });
  // The columns a card could show under its title: all but the title (shown above) and the cover
  const cardFieldCandidates = computed(() => {
    const titleId = (fields.value.find((field) => isPageField(field)) || fields.value[0])?.id;
    return fields.value.filter((field) => field.id !== titleId && field.id !== galleryCardField.value?.id);
  });
  // Those a Gallery / Board card does show: the ones chosen for the cards, else every one the view shows
  const cardBodyFields = computed(() => {
    const chosen = activeSavedView.value?.config?.cardFieldIds;
    if (Array.isArray(chosen)) return cardFieldCandidates.value.filter((field) => chosen.includes(field.id));
    return cardFieldCandidates.value.filter((field) => !hiddenFieldIdSet.value.has(field.id));
  });
  const rowTitle = (row) => {
    const titleField = fields.value.find((field) => isPageField(field)) || fields.value[0];
    if (!titleField) return 'Untitled';
    const value = displayValueForField(row, titleField);
    const text = Array.isArray(value) ? value.join(', ') : stringifyValue(value);
    return text || 'Untitled';
  };
  const galleryCardValue = (row, field) => {
    const value = displayValueForField(row, field);
    return Array.isArray(value) ? value.join(', ') : stringifyValue(value);
  };
  const openRowCard = async (row) => {
    const existingId = rowPageId(row);
    if (existingId) {
      if (typeof openRowPageOverlay === 'function') openRowPageOverlay(existingId);
      else workspace.loadPageDoc(existingId);
      return;
    }
    if (isReadonly.value) return;
    const targetPage = await ensureRowPage(row, { title: rowTitle(row) });
    if (targetPage && typeof openRowPageOverlay === 'function') openRowPageOverlay(targetPage);
  };

  return { viewFilteredRows, viewSorting, shownRows, boardColumns, cardBodyFields, cardFieldCandidates, galleryCardField, galleryCardValue, openRowCard, rowTitle };
}
