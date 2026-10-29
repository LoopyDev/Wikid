import { computed, nextTick, ref } from 'vue';
import { api } from '../api/client';
import { normalizeFieldOptions } from '../utils/database/fieldOptions';
import { normalizeViewConfig, normalizeViewType, operatorsForFieldType, VIEW_TYPE_LABELS } from '../utils/database/views';

// A database's saved views (table, board, gallery): creating, renaming and deleting them, and
// their filters, sorts and board/gallery settings, saved shortly after each change; plus the filter
// and sort menus.
export function useSavedViews({ props, workspace, fields, fieldById, activeViewId, activeSavedView, hasApi, activeUser, error, canCreateForms, runWithSavingIndicator, closeFormMenu, closeColumnsMenu, getChoiceLabel, databaseRootRef }) {
  const savedViews = ref([]);
  const filterMenu = ref({ open: false, x: 0, y: 0 });
  const filterMenuRef = ref(null);
  const sortMenu = ref({ open: false, x: 0, y: 0 });
  const sortMenuRef = ref(null);
  const DEFAULT_VIEW_ICONS = { TABLE: 'icon:table', GALLERY: 'icon:grid-3x3-gap', BOARD: 'icon:kanban', LIST: 'icon:list-ul' };
  const normalizeSavedView = (view) => {
    if (!view || typeof view !== 'object') return null;
    const id = typeof view.id === 'string' ? view.id : '';
    if (!id) return null;
    const type = normalizeViewType(view.type);
    const rawName = typeof view.name === 'string' ? view.name.trim() : '';
    const name = rawName || 'View';
    const icon = typeof view.icon === 'string' && view.icon.trim() ? view.icon.trim() : DEFAULT_VIEW_ICONS[type];
    return { id, name, type, icon, config: normalizeViewConfig(view.config) };
  };
  // NOTE: toComparableDate / matchesFilterRule / viewFilteredRows / viewSorting
  // are defined just above `useVueTable` because the table reads them during
  // setup (see the block preceding `const table = useVueTable`).
  const activeViewFilters = computed(() => activeSavedView.value?.config?.filters || { match: 'AND', rules: [] });
  const activeViewSorts = computed(() => activeSavedView.value?.config?.sorts || []);
  const activeFilterCount = computed(() => activeViewFilters.value.rules.length);
  // --- Persistence (debounced) ---
  const viewSaveTimers = new Map();
  // Each view's latest save: a reply to an older one is out of date (two saves can overlap, and
  // their replies come back in either order), so it doesn't replace what's shown
  const latestViewSave = new Map();
  const scheduleViewPersist = (viewId, payload) => {
    if (!hasApi.value || !activeUser.value) return;
    const existing = viewSaveTimers.get(viewId);
    const started = existing?.started || workspace.beginSaving();
    if (existing?.timer) clearTimeout(existing.timer);
    const timer = setTimeout(async () => {
      viewSaveTimers.delete(viewId);
      const save = (latestViewSave.get(viewId) || 0) + 1;
      latestViewSave.set(viewId, save);
      try {
        const res = await api.updateDatabaseView(viewId, payload, {
          userId: activeUser.value.id,
          userName: activeUser.value.name,
        });
        const normalized = normalizeSavedView(res);
        // Only the reply to the latest save, with no newer change waiting to go, is shown
        if (normalized && latestViewSave.get(viewId) === save && !viewSaveTimers.has(viewId)) {
          savedViews.value = savedViews.value.map((view) => (view.id === viewId ? normalized : view));
        }
      } catch (err) {
        console.warn('Update view failed', err);
        error.value = err?.message || 'Failed to update view';
      } finally {
        workspace.finishSaving(started);
      }
    }, 400);
    viewSaveTimers.set(viewId, { timer, started });
  };
  const patchViewConfig = (viewId, partial) => {
    const view = savedViews.value.find((entry) => entry.id === viewId);
    if (!view) return;
    const nextConfig = { ...view.config, ...partial };
    savedViews.value = savedViews.value.map((entry) => (entry.id === viewId ? { ...entry, config: nextConfig } : entry));
    scheduleViewPersist(viewId, { config: nextConfig });
  };
  const patchActiveViewConfig = (partial) => {
    if (activeSavedView.value) patchViewConfig(activeSavedView.value.id, partial);
  };
  // --- CRUD ---
  const createSavedView = async (type = 'TABLE') => {
    if (!canCreateForms.value) return;
    const viewType = normalizeViewType(type);
    const defaultName = `${VIEW_TYPE_LABELS[viewType]} ${savedViews.value.length + 1}`;
    closeFormMenu();
    if (!hasApi.value || !activeUser.value) return;
    const config = {};
    if (viewType === 'BOARD') {
      const selectField = fields.value.find((field) => field.type === 'SELECT');
      if (selectField) config.groupFieldId = selectField.id;
    }
    try {
      const res = await runWithSavingIndicator(() =>
        api.createDatabaseView(
          props.pageId,
          { name: defaultName, type: viewType, config },
          { userId: activeUser.value.id, userName: activeUser.value.name }
        )
      );
      const nextView = normalizeSavedView(res);
      if (!nextView) return;
      savedViews.value = [...savedViews.value, nextView];
      activeViewId.value = nextView.id;
    } catch (err) {
      console.warn('Create view failed', err);
      error.value = err?.message || 'Failed to create view';
    }
  };
  const deleteSavedView = async (view) => {
    if (!view || !canCreateForms.value) return;
    if (!window.confirm(`Delete view "${view.name}"?`)) return;
    if (!hasApi.value || !activeUser.value) return;
    try {
      await runWithSavingIndicator(() =>
        api.deleteDatabaseView(view.id, { userId: activeUser.value.id, userName: activeUser.value.name })
      );
      savedViews.value = savedViews.value.filter((entry) => entry.id !== view.id);
      if (activeViewId.value === view.id) activeViewId.value = 'table';
      closeFilterMenu();
      closeSortMenu();
    } catch (err) {
      console.warn('Delete view failed', err);
      error.value = err?.message || 'Failed to delete view';
    }
  };
  const renameSavedView = (view) => {
    if (!view || !canCreateForms.value) return;
    const raw = window.prompt('View name', view.name);
    if (raw === null) return;
    const name = raw.trim() || view.name;
    savedViews.value = savedViews.value.map((entry) => (entry.id === view.id ? { ...entry, name } : entry));
    scheduleViewPersist(view.id, { name });
  };
  // --- Filter rule editing ---
  const setFilterMatch = (match) => {
    patchActiveViewConfig({ filters: { ...activeViewFilters.value, match: match === 'OR' ? 'OR' : 'AND' } });
  };
  const addFilterRule = () => {
    const field = fields.value[0];
    if (!field) return;
    const operator = operatorsForFieldType(field.type)[0];
    const rules = [...activeViewFilters.value.rules, { fieldId: field.id, operator, value: null }];
    patchActiveViewConfig({ filters: { ...activeViewFilters.value, rules } });
  };
  const updateFilterRule = (index, patch) => {
    const rules = activeViewFilters.value.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
    patchActiveViewConfig({ filters: { ...activeViewFilters.value, rules } });
  };
  const changeFilterRuleField = (index, fieldId) => {
    const field = fieldById.value.get(fieldId);
    if (!field) return;
    updateFilterRule(index, { fieldId, operator: operatorsForFieldType(field.type)[0], value: null });
  };
  const removeFilterRule = (index) => {
    const rules = activeViewFilters.value.rules.filter((_, i) => i !== index);
    patchActiveViewConfig({ filters: { ...activeViewFilters.value, rules } });
  };
  // --- Sort rule editing ---
  const addSortRule = () => {
    const field =
      fields.value.find((f) => !activeViewSorts.value.some((sort) => sort.fieldId === f.id)) || fields.value[0];
    if (!field) return;
    patchActiveViewConfig({ sorts: [...activeViewSorts.value, { fieldId: field.id, direction: 'asc' }] });
  };
  const updateSortRule = (index, patch) => {
    const sorts = activeViewSorts.value.map((sort, i) => (i === index ? { ...sort, ...patch } : sort));
    patchActiveViewConfig({ sorts });
  };
  const removeSortRule = (index) => {
    patchActiveViewConfig({ sorts: activeViewSorts.value.filter((_, i) => i !== index) });
  };
  const setBoardGroupField = (fieldId) => {
    patchActiveViewConfig({ groupFieldId: fieldId || null });
  };
  const setGalleryCardField = (fieldId) => {
    patchActiveViewConfig({ cardFieldId: fieldId || null });
  };
  // Which columns a gallery's cards show (a list of ids; null for every column the view shows)
  const setGalleryCardFields = (fieldIds) => {
    patchActiveViewConfig({ cardFieldIds: Array.isArray(fieldIds) ? fieldIds : null });
  };
  // How many of a cover's linked rows show before "Show more"
  const setGalleryCoverMax = (value) => {
    const max = Number.parseInt(value, 10);
    patchActiveViewConfig({ coverMaxItems: Number.isInteger(max) && max >= 1 ? Math.min(max, 50) : null });
  };
  // --- Value input helpers for the condition builder ---
  const fieldChoices = (field) => {
    if (!field) return [];
    return normalizeFieldOptions(field).choices.map((choice) => ({
      value: choice.value,
      label: getChoiceLabel(field, choice.value) || choice.value,
    }));
  };
  // --- Filter / Sort menu positioning ---
  const positionRootMenu = async (event, menuRef, setter) => {
    const rect = event.currentTarget?.getBoundingClientRect?.();
    const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
    const rootLeft = rootRect?.left ?? 0;
    const rootTop = rootRect?.top ?? 0;
    const x = (rect?.left ?? event.clientX ?? 0) - rootLeft;
    const y = (rect?.bottom ?? event.clientY ?? 0) - rootTop + 6;
    setter({ open: true, x, y });
    await nextTick();
    if (typeof window !== 'undefined' && menuRef.value) {
      const padding = 12;
      const bounds = menuRef.value.getBoundingClientRect();
      const maxX = window.innerWidth - bounds.width - rootLeft - padding;
      const maxY = window.innerHeight - bounds.height - rootTop - padding;
      const minX = padding - rootLeft;
      const minY = padding - rootTop;
      const nextX = Math.min(Math.max(minX, x), Math.max(minX, maxX));
      const nextY = Math.min(Math.max(minY, y), Math.max(minY, maxY));
      if (nextX !== x || nextY !== y) setter({ open: true, x: nextX, y: nextY });
    }
  };
  const closeFilterMenu = () => {
    filterMenu.value = { open: false, x: 0, y: 0 };
  };
  const openFilterMenu = async (event) => {
    if (!event || !activeSavedView.value) return;
    if (filterMenu.value.open) {
      closeFilterMenu();
      return;
    }
    closeSortMenu();
    closeColumnsMenu();
    closeFormMenu();
    await positionRootMenu(event, filterMenuRef, (value) => {
      filterMenu.value = value;
    });
  };
  const closeSortMenu = () => {
    sortMenu.value = { open: false, x: 0, y: 0 };
  };
  const openSortMenu = async (event) => {
    if (!event || !activeSavedView.value) return;
    if (sortMenu.value.open) {
      closeSortMenu();
      return;
    }
    closeFilterMenu();
    closeColumnsMenu();
    closeFormMenu();
    await positionRootMenu(event, sortMenuRef, (value) => {
      sortMenu.value = value;
    });
  };
  const filterMenuStyle = computed(() => ({ top: `${filterMenu.value.y}px`, left: `${filterMenu.value.x}px` }));
  const sortMenuStyle = computed(() => ({ top: `${sortMenu.value.y}px`, left: `${sortMenu.value.x}px` }));

  return { savedViews, normalizeSavedView, createSavedView, deleteSavedView, renameSavedView, patchActiveViewConfig, activeViewFilters, activeViewSorts, activeFilterCount, setFilterMatch, addFilterRule, updateFilterRule, changeFilterRuleField, removeFilterRule, addSortRule, updateSortRule, removeSortRule, setBoardGroupField, setGalleryCardField, setGalleryCardFields, setGalleryCoverMax, fieldChoices, filterMenu, filterMenuRef, filterMenuStyle, openFilterMenu, closeFilterMenu, sortMenu, sortMenuRef, sortMenuStyle, openSortMenu, closeSortMenu };
}
