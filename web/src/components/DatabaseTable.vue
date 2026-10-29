<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import * as Y from 'yjs';
import {
  FlexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useVueTable,
} from '@tanstack/vue-table';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import PageIcon from './PageIcon.vue';
import FormBuilder from './FormBuilder.vue';
import { getAssetTagValue, getMultiSelectValues, getMultiSelectValuesFromRaw, getRelationEntries, getRowIdValue, normalizeCellValue, normalizeFilterValues, normalizeRelationEntry, pruneMultiSelectValues, renderRowIdCell, shouldClearCell, stringifyValue, valueForField } from '../utils/database/cellValues';
import { clearYMap, cloneForSeed, ensureCollabRowDataMap, generateId, hydrateRow, readCollabOrder } from '../utils/database/collabRows';
import { multiSelectDotStyle } from '../utils/database/colors';
import { ADD_COLUMN_ID, ADD_COLUMN_LABEL, ADD_COLUMN_SIZE, ASSET_TAG_COLUMN_SIZE, AUTO_SIZE_BASE, AUTO_SIZE_BUFFER, AUTO_SIZE_CHAR_LIMIT, AUTO_SIZE_CHAR_WIDTH, AUTO_SIZE_FIRST_EXTRA, AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER, AUTO_SIZE_MULTI_PILL_GAP, AUTO_SIZE_MULTI_PILL_PADDING, AUTO_SIZE_MULTI_PLACEHOLDER, AUTO_SIZE_PAGE_ICON_EXTRA, AUTO_SIZE_RELATION_PLACEHOLDER, AUTO_SIZE_SELECT_EXTRA, AUTO_SIZE_SELECT_PLACEHOLDER, COLUMN_DEFAULT_SIZE, COLUMN_MAX_SIZE, COLUMN_MIN_SIZE, ROW_ID_COLUMN_ID, ROW_ID_COLUMN_LABEL, ROW_ID_COLUMN_MIN_SIZE, ROW_ID_COLUMN_SIZE } from '../utils/database/columnLayout';
import { AUDIT_VIEW_ID, DEFAULT_INITIAL_STATUS, GOVERNANCE_FILTER_ID, auditStatusOptions, getAuditStatusClass, getComplianceRecordId } from '../utils/database/compliance';
import { fieldTypeIcons, fieldTypes, getFieldSource, getLinkedFromConfig, getMultiSelectChoiceValues, getRelationConfig, isAssetTagField, isLinkedFromField, isFieldDeleteLocked, isFieldOptionsLocked, isFieldReadOnly, isFieldTypeLocked, isLastEditedField, isMembersField, isPageField, isRelationField, isSelectField, normalizeFieldOptions } from '../utils/database/fieldOptions';
import { DEFAULT_FORM_ICON, buildFormField, normalizeFormIcon } from '../utils/database/forms';
import { OPERATOR_LABELS, operatorNeedsValue, operatorsForFieldType, sortByType } from '../utils/database/views';
import { colorFromId } from '../utils/presenceColor';
import { useCellPresence } from '../composables/useCellPresence';
import { useDatabaseCollab } from '../composables/useDatabaseCollab';
import { useSavedViews } from '../composables/useSavedViews';
import { useViewRows } from '../composables/useViewRows';
import { useCellRenderer } from '../composables/useCellRenderer';
import { useLinkedFrom } from '../composables/useLinkedFrom';
import { useColumnReorder } from '../composables/useColumnReorder';

const props = defineProps({
  pageId: {
    type: String,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  collab: {
    type: Object,
    default: null, // { docName, token, url }
  },
  embedded: {
    type: Boolean,
    default: false,
  },
  hiddenFieldIds: {
    type: Array,
    default: null,
  },
  viewId: {
    type: String,
    default: null,
  },
  toolbarTeleportTo: {
    type: [String, Object],
    default: null,
  },
});
const emit = defineEmits(['collabready', 'collabpresence', 'update:hiddenFieldIds']);

const workspace = useWorkspaceStore();
const openRowPageOverlay = inject('openRowPageOverlay', null);
const openFormPage = inject('openFormPage', null);
const loading = ref(false);
const error = ref(null);
const fields = ref([]);
// "Linked from" columns: the rows of other databases linking to these ones
const { linkedRowsFor, incomingRelations, incomingRelationsLoading, loadIncomingRelations } = useLinkedFrom({
  pageId: computed(() => props.pageId),
  fields,
  workspace,
});
const rows = ref([]);
const sorting = ref([]);
const sortRefreshScheduled = ref(false);
const scheduleSortRefresh = () => {
  if (!sorting.value.length) return;
  if (sortRefreshScheduled.value) return;
  sortRefreshScheduled.value = true;
  const run = () => {
    // If focus moved to another cell within the table, defer the sort refresh
    // to avoid destroying the newly focused input during re-render.
    const active = document.activeElement;
    if (active && tableWrapRef.value?.contains(active)) {
      sortRefreshScheduled.value = false;
      return;
    }
    sortRefreshScheduled.value = false;
    rows.value = [...rows.value];
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
};
const globalFilter = ref('');
const selectedRowIds = ref(new Set());
const columnSizing = ref({});
const columnSizingInfo = ref({});
const rowSaveTimers = new Map();
const pageTitleUpdateTimers = new Map();
const rowPageEnsuring = new Set();
const fieldMenu = ref({ open: false, fieldId: null, x: 0, y: 0 });
const addFieldMenu = ref({ open: false, x: 0, y: 0 });
// Adding a "Linked from" column when more than one relation points here: those to choose from
const addFieldLinkedFromChoices = ref(null);
const multiSelectMenu = ref({ open: false, fieldId: null, rowId: null, x: 0, y: 0 });
const rowMenu = ref({ open: false, rowId: null, x: 0, y: 0 });
const columnsMenu = ref({ open: false, x: 0, y: 0 });
const formMenu = ref({ open: false, x: 0, y: 0 });
const assetTagPreview = ref({ open: false, value: '', dataUrl: '', loading: false, error: '' });
const databaseRootRef = ref(null);
const tableWrapRef = ref(null);
const tableWrapWidth = ref(0);
let tableWrapObserver = null;
const addFieldName = ref('');
const fieldNameDraft = ref('');
const optionsDraft = ref([]);
const optionsDraftFieldId = ref(null);
const relationDraftPageId = ref('');
const relationDraftFieldId = ref(null);
const relationDraftAllowMultiple = ref(false);
const relationDraftHistoryEnabled = ref(false);
const relationDraftHistoryPageId = ref('');
const relationOptionsByPageId = ref({});
const relationFieldsByPageId = ref({});
const relationRowsByPageId = ref({});
const relationOptionsLoading = ref({});
const relationOptionsError = ref({});
const panelState = ref('root');
const menuDir = ref('forward');
const fieldMenuRef = ref(null);
const addFieldMenuRef = ref(null);
const multiSelectMenuRef = ref(null);
const rowMenuRef = ref(null);
const columnsMenuRef = ref(null);
const formMenuRef = ref(null);
const addFieldNameRef = ref(null);
const optionInputRefs = ref([]);
const filterInputRef = ref(null);
const filterOpen = ref(false);
const lastLoadedSnapshot = ref(null);
const formViews = ref([]);
const activeViewId = ref('table');
// True while the table's live document isn't connected (set from useDatabaseCollab below): editing
// pauses, as on pages, so changes aren't silently held back.
const connectionPaused = ref(false);
const isReadonly = computed(() => props.readonly || connectionPaused.value);
const databasePage = computed(() => workspace.pages.find((page) => page.id === props.pageId) || null);
const wikiHomeId = computed(() => databasePage.value?.wikiHomeId || null);
const isWikiDatabase = computed(
  () => !!databasePage.value?.isHidden && !!wikiHomeId.value && databasePage.value?.kind === 'DATABASE'
);
const pageMap = computed(() => new Map(workspace.pages.map((page) => [page.id, page])));
const relationTargetPages = computed(() => {
  const isCompliance = databasePage.value?.databaseComplianceMode === true;
  return workspace.pages.filter(
    (page) =>
      page.kind === 'DATABASE' &&
      page.id !== props.pageId &&
      !page.isDeleted &&
      !page.isHidden &&
      (!isCompliance || page.databaseComplianceMode === true)
  );
});
const fieldById = computed(() => new Map(fields.value.map((field) => [field.id, field])));
const membersWorkspaceId = computed(() => databasePage.value?.workspaceId || workspace.activeWorkspaceId || null);
const workspaceMembers = ref([]);
const membersLoading = ref(false);
const membersLoadedFor = ref(null);

const canCreateForms = computed(() => !props.embedded && !isReadonly.value);
const activeSavedView = computed(() => savedViews.value.find((view) => view.id === activeViewId.value) || null);
const activeViewType = computed(() => activeSavedView.value?.type || null);
const isTableView = computed(() => activeViewId.value === 'table');
const isFormsView = computed(() => activeViewId.value === 'forms');
const isComplianceDatabase = computed(() => databasePage.value?.databaseComplianceMode === true);
const canShowAudit = computed(() => !props.embedded && isComplianceDatabase.value);
const isAuditView = computed(() => activeViewId.value === AUDIT_VIEW_ID);
const isGalleryView = computed(() => activeViewType.value === 'GALLERY');
const isBoardView = computed(() => activeViewType.value === 'BOARD');
const isListView = computed(() => activeViewType.value === 'LIST');
// Table markup is shared by the built-in Table tab, the Audit view, and any
// saved view of type TABLE.
const showTableView = computed(() => isTableView.value || isAuditView.value || activeViewType.value === 'TABLE');
const showFormTabs = computed(
  () =>
    !props.embedded &&
    (formViews.value.length > 0 || savedViews.value.length > 0 || canCreateForms.value || canShowAudit.value)
);

const auditStatusIds = new Set(auditStatusOptions.map((status) => status.id));

const complianceStatusByRecordId = ref(new Map());

const runWithSavingIndicator = async (task) => {
  const started = workspace.beginSaving();
  try {
    return await task();
  } finally {
    workspace.finishSaving(started);
  }
};

const updateTableWrapWidth = () => {
  const wrapWidth = tableWrapRef.value?.clientWidth || 0;
  const rootWidth = databaseRootRef.value?.clientWidth || 0;
  tableWrapWidth.value = wrapWidth || rootWidth;
};

const hasApi = computed(() => workspace.hasApi);
const activeUser = computed(() => workspace.activeUser);
const membersMap = computed(() => new Map(workspaceMembers.value.map((member) => [member.id, member.name])));

const pageTitleFieldId = computed(() => fields.value.find((field) => isPageField(field))?.id || null);
const emitPageTitleUpdated = (pageId, title) => {
  if (typeof window === 'undefined' || !pageId) return;
  window.dispatchEvent(
    new CustomEvent('wikid:page-title-updated', {
      detail: { pageId, title },
    })
  );
};

const emitFieldUpdated = (field) => {
  if (typeof window === 'undefined' || !field?.id) return;
  window.dispatchEvent(
    new CustomEvent('wikid:db-field-updated', {
      detail: {
        databasePageId: props.pageId,
        field: {
          id: field.id,
          name: field.name || '',
          type: field.type,
          options: field.options || {},
        },
      },
    })
  );
};

const buildFormFieldsFromDatabase = () => fields.value.filter((field) => field?.id).map(buildFormField);

const normalizeFormAuto = (raw, fieldId, selectSource = null) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (type === 'template') {
    const template = typeof raw.template === 'string' ? raw.template.trim() : '';
    return template ? { type, template } : null;
  }
  if (type === 'currentUser') {
    const mode = typeof raw.mode === 'string' ? raw.mode.trim() : '';
    if (mode === 'id' || mode === 'name') {
      return { type, mode };
    }
    return { type };
  }
  if (type === 'fixed') {
    const value = typeof raw.value === 'string' ? raw.value.trim() : '';
    if (!value) return null;
    const field = fieldId ? fields.value.find((entry) => entry?.id === fieldId) : null;
    if (!field || (field.type !== 'SELECT' && field.type !== 'RELATION')) return null;
    if (field.type === 'RELATION') {
      return { type, value };
    }
    if (selectSource?.type === 'relation') {
      return { type, value };
    }
    const choices = normalizeFieldOptions(field).choices.map((choice) => choice.value);
    if (!choices.includes(value)) return null;
    return { type, value };
  }
  return null;
};

const normalizeFormSelectSource = (raw, fieldId) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (type !== 'relation') return null;
  const relationFieldId = typeof raw.relationFieldId === 'string' ? raw.relationFieldId.trim() : '';
  const targetFieldId = typeof raw.targetFieldId === 'string' ? raw.targetFieldId.trim() : '';
  if (!relationFieldId || !targetFieldId) return null;
  const field = fields.value.find((entry) => entry?.id === fieldId);
  if (!field || field.type !== 'SELECT') return null;
  const relationField = fields.value.find((entry) => entry?.id === relationFieldId);
  if (!relationField || relationField.type !== 'RELATION') return null;
  const relation = getRelationConfig(relationField);
  if (!relation?.pageId) return null;
  return { type, relationFieldId, targetFieldId };
};

const normalizeFormCondition = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fieldId = typeof raw.fieldId === 'string' ? raw.fieldId.trim() : '';
  if (!fieldId) return null;
  const op = typeof raw.op === 'string' ? raw.op.trim() : 'equals';
  if (op === 'isFilled' || op === 'isEmpty') {
    const field = fieldById.value.get(fieldId);
    if (!field) return null;
    return { fieldId, op };
  }
  if (op !== 'equals') return null;
  const field = fields.value.find((entry) => entry?.id === fieldId);
  if (!field || field.type !== 'SELECT') return null;
  const choices = normalizeFieldOptions(field).choices.map((choice) => choice.value);
  const rawValue = typeof raw.value === 'string' ? raw.value.trim() : '';
  if (!rawValue || !choices.includes(rawValue)) return null;
  return { fieldId, op, value: rawValue };
};

const normalizeFormRequiredWhen = (raw) => normalizeFormCondition(raw);
const normalizeFormVisibleWhen = (raw) => normalizeFormCondition(raw);

const normalizeFormFieldEntry = (entry) => {
  if (typeof entry === 'string') {
    const fieldId = entry.trim();
    return fieldId ? { fieldId, label: null, required: false, editable: true } : null;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const rawFieldId = typeof entry.fieldId === 'string' ? entry.fieldId : typeof entry.id === 'string' ? entry.id : '';
  const fieldId = rawFieldId.trim();
  if (!fieldId) return null;
  const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
  const label = rawLabel ? rawLabel : null;
  const required = typeof entry.required === 'boolean' ? entry.required : false;
  const editable = typeof entry.editable === 'boolean' ? entry.editable : true;
  const selectSource = normalizeFormSelectSource(entry.selectSource, fieldId);
  const auto = normalizeFormAuto(entry.auto, fieldId, selectSource);
  const requiredWhen = normalizeFormRequiredWhen(entry.requiredWhen);
  const visibleWhen = normalizeFormVisibleWhen(entry.visibleWhen);
  const base = auto ? { fieldId, label, required, editable, auto } : { fieldId, label, required, editable };
  const withSource = selectSource ? { ...base, selectSource } : base;
  const withRequired = requiredWhen ? { ...withSource, requiredWhen } : withSource;
  return visibleWhen ? { ...withRequired, visibleWhen } : withRequired;
};

const normalizeFormFields = (rawFields) => {
  if (!Array.isArray(rawFields)) return [];
  const allowed = new Set(fields.value.map((field) => field.id));
  const seen = new Set();
  const next = [];
  rawFields.forEach((entry) => {
    const normalized = normalizeFormFieldEntry(entry);
    if (!normalized || !allowed.has(normalized.fieldId) || seen.has(normalized.fieldId)) return;
    seen.add(normalized.fieldId);
    next.push(normalized);
  });
  return next;
};

const normalizeFormStorage = (rawFields) => {
  if (Array.isArray(rawFields)) return { fields: rawFields, config: null };
  if (rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)) {
    const fields = Array.isArray(rawFields.fields) ? rawFields.fields : [];
    const config = rawFields.config && typeof rawFields.config === 'object' && !Array.isArray(rawFields.config)
      ? rawFields.config
      : null;
    return { fields, config };
  }
  return { fields: [], config: null };
};

const normalizeFormConfig = (rawConfig) => {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return { mode: 'create', filter: null, successMessage: '', showReturnButton: false, initialStatus: DEFAULT_INITIAL_STATUS };
  }
  const allowedFields = new Set(fields.value.map((field) => field.id));
  const mode = rawConfig.mode === 'update' ? 'update' : 'create';
  const rawFilter = rawConfig.filter && typeof rawConfig.filter === 'object' && !Array.isArray(rawConfig.filter)
    ? rawConfig.filter
    : null;
  const fieldId = rawFilter && typeof rawFilter.fieldId === 'string' ? rawFilter.fieldId : '';
  const validFieldId =
    allowedFields.has(fieldId) || (isComplianceDatabase.value && fieldId === GOVERNANCE_FILTER_ID)
      ? fieldId
      : '';
  const op = rawFilter && typeof rawFilter.op === 'string' ? rawFilter.op : 'isEmpty';
  const value = rawFilter && rawFilter.value !== undefined ? rawFilter.value : '';
  const filter = validFieldId ? { fieldId: validFieldId, op, value } : null;
  const successMessage = typeof rawConfig.successMessage === 'string' ? rawConfig.successMessage : '';
  const showReturnButton = rawConfig.showReturnButton === true;
  const rawStatus = typeof rawConfig.initialStatus === 'string' ? rawConfig.initialStatus.trim().toUpperCase() : '';
  const initialStatus = auditStatusIds.has(rawStatus) ? rawStatus : DEFAULT_INITIAL_STATUS;
  const rawTransition =
    typeof rawConfig.transitionStatus === 'string' ? rawConfig.transitionStatus.trim().toUpperCase() : '';
  const transitionStatus =
    isComplianceDatabase.value && auditStatusIds.has(rawTransition) ? rawTransition : '';
  return {
    mode,
    filter,
    successMessage,
    showReturnButton,
    initialStatus,
    ...(transitionStatus ? { transitionStatus } : {}),
  };
};

const normalizeFormView = (form) => {
  if (!form || typeof form !== 'object') return null;
  const id = typeof form.id === 'string' ? form.id : '';
  if (!id) return null;
  const rawName = typeof form.name === 'string' ? form.name.trim() : '';
  const name = rawName || 'Form';
  const icon = normalizeFormIcon(form.icon);
  const storage = normalizeFormStorage(form.fields);
  const fields = normalizeFormFields(storage.fields);
  const config = normalizeFormConfig(form.config || storage.config);
  return { id, name, icon, fields, config };
};

const closeFormMenu = () => {
  formMenu.value = { open: false, x: 0, y: 0 };
};

const openFormMenu = async (event) => {
  if (!event || !canCreateForms.value) return;
  if (formMenu.value.open) {
    closeFormMenu();
    return;
  }
  commitFieldName();
  commitFieldOptions();
  commitRelationOptions();
  closeRowMenu();
  closeFieldMenu();
  closeAddFieldMenu();
  closeMultiSelectMenu();
  closeColumnsMenu();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
  const rootLeft = rootRect?.left ?? 0;
  const rootTop = rootRect?.top ?? 0;
  let x = (rect?.left ?? event.clientX ?? 0) - rootLeft;
  let y = (rect?.bottom ?? event.clientY ?? 0) - rootTop;
  y += 6;
  formMenu.value = { open: true, x, y };
  await nextTick();
  if (typeof window !== 'undefined' && formMenuRef.value) {
    const padding = 12;
    const bounds = formMenuRef.value.getBoundingClientRect();
    const maxX = window.innerWidth - bounds.width - rootLeft - padding;
    const maxY = window.innerHeight - bounds.height - rootTop - padding;
    const minX = padding - rootLeft;
    const minY = padding - rootTop;
    const nextX = Math.min(Math.max(minX, x), Math.max(minX, maxX));
    const nextY = Math.min(Math.max(minY, y), Math.max(minY, maxY));
    if (nextX !== x || nextY !== y) {
      formMenu.value = { open: true, x: nextX, y: nextY };
    }
  }
};

const createFormView = async () => {
  if (!canCreateForms.value) return;
  const defaultName = `Form ${formViews.value.length + 1}`;
  const rawName = window.prompt('Form name', defaultName);
  if (rawName === null) {
    closeFormMenu();
    return;
  }
  const name = rawName.trim() || defaultName;
  const shouldGenerate = window.confirm('Generate form fields from current database columns?');
  const fieldsForForm = shouldGenerate ? buildFormFieldsFromDatabase() : [];
  closeFormMenu();
  if (!hasApi.value || !activeUser.value) return;
  try {
    const res = await runWithSavingIndicator(() =>
      api.createDatabaseForm(
        props.pageId,
        { name, icon: DEFAULT_FORM_ICON, fields: fieldsForForm },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    const nextForm = normalizeFormView(res);
    if (!nextForm) return;
    formViews.value = [...formViews.value, nextForm];
    activeViewId.value = nextForm.id;
  } catch (err) {
    console.warn('Create form failed', err);
    error.value = err?.message || 'Failed to create form';
  }
};

const deleteFormView = async (form) => {
  if (!form || !canCreateForms.value) return;
  const name = typeof form.name === 'string' && form.name.trim() ? form.name.trim() : 'Form';
  const confirmed = window.confirm(`Delete form "${name}"?`);
  if (!confirmed) return;
  if (!hasApi.value || !activeUser.value) return;
  try {
    await runWithSavingIndicator(() =>
      api.deleteDatabaseForm(form.id, { userId: activeUser.value.id, userName: activeUser.value.name })
    );
    const remaining = formViews.value.filter((entry) => entry.id !== form.id);
    formViews.value = remaining;
    if (activeViewId.value === form.id) {
      activeViewId.value = remaining.length ? 'forms' : 'table';
    }
  } catch (err) {
    console.warn('Delete form failed', err);
    error.value = err?.message || 'Failed to delete form';
  }
};

const handleOpenFormFromList = (formId) => {
  if (!formId) return;
  if (typeof openFormPage === 'function') {
    openFormPage(formId);
  }
};

const syncComplianceStatusCache = (rowList) => {
  const nextMap = new Map(complianceStatusByRecordId.value);
  (rowList || []).forEach((row) => {
    const recordId = getComplianceRecordId(row);
    if (!recordId) return;
    const status = typeof row?.complianceStatus === 'string' ? row.complianceStatus : '';
    if (status) {
      nextMap.set(recordId, status);
      return;
    }
    if (nextMap.has(recordId)) {
      row.complianceStatus = nextMap.get(recordId) ?? null;
    }
  });
  complianceStatusByRecordId.value = nextMap;
};

const getRowComplianceStatus = (row) => {
  const direct = typeof row?.complianceStatus === 'string' ? row.complianceStatus : '';
  if (direct) return direct;
  const recordId = getComplianceRecordId(row);
  if (!recordId) return '';
  return complianceStatusByRecordId.value.get(recordId) || '';
};

const getAuditRowClass = (row) => {
  if (!isAuditView.value) return '';
  const tone = getAuditStatusClass(getRowComplianceStatus(row));
  return tone ? `db-row--audit db-row--audit-${tone}` : 'db-row--audit';
};

const relationOptionsForPage = (pageId) => relationOptionsByPageId.value[pageId] || [];
const relationOptionsLoadingForPage = (pageId) => relationOptionsLoading.value[pageId] === true;
const relationOptionsErrorForPage = (pageId) => relationOptionsError.value[pageId] || '';

const loadRelationOptions = async (pageId, { force = false } = {}) => {
  if (!pageId) return;
  if (!hasApi.value || !activeUser.value) return;
  if (!force && relationOptionsByPageId.value[pageId]) return;
  if (relationOptionsLoading.value[pageId]) return;
  relationOptionsLoading.value = { ...relationOptionsLoading.value, [pageId]: true };
  relationOptionsError.value = { ...relationOptionsError.value, [pageId]: '' };
  try {
    const user = { userId: activeUser.value.id, userName: activeUser.value.name };
    // The rows' names from the live document too: the saved rows can be a few minutes behind a rename
    const [res, live] = await Promise.all([api.getDatabase(pageId, user), api.getRowTitles(pageId, user).catch(() => null)]);
    const targetFields = Array.isArray(res?.fields) ? res.fields : [];
    const targetRows = Array.isArray(res?.rows) ? res.rows : [];
    const fieldOptions = targetFields
      .map((field) => ({
        id: field?.id || '',
        name: field?.name || 'Field',
        type: field?.type || null,
      }))
      .filter((field) => field.id);
    const rowEntries = targetRows
      .map((row) => ({
        id: row?.id || '',
        data: row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {},
      }))
      .filter((row) => row.id);
    const titleFieldId =
      targetFields.find((field) => getFieldSource(field) === 'page')?.id || targetFields[0]?.id || null;
    // Each with the row's own page, if it has one, for opening it from a relation's pill
    const savedOptions = () =>
      targetRows
        .map((row) => {
          const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
          const label = titleFieldId ? stringifyValue(data[titleFieldId]) : '';
          const fallback = label || (row?.id ? String(row.id) : '');
          return row?.id ? { id: row.id, label: fallback, pageId: row.pageId || null } : null;
        })
        .filter(Boolean);
    const options = Array.isArray(live?.rows)
      ? live.rows.filter((row) => row?.id).map((row) => ({ id: row.id, label: row.title || String(row.id), pageId: row.pageId || null }))
      : savedOptions();
    relationOptionsByPageId.value = { ...relationOptionsByPageId.value, [pageId]: options };
    relationFieldsByPageId.value = { ...relationFieldsByPageId.value, [pageId]: fieldOptions };
    relationRowsByPageId.value = { ...relationRowsByPageId.value, [pageId]: rowEntries };
  } catch (err) {
    console.warn('Load relation options failed', err);
    relationOptionsError.value = { ...relationOptionsError.value, [pageId]: err?.message || 'Failed to load relations' };
  } finally {
    relationOptionsLoading.value = { ...relationOptionsLoading.value, [pageId]: false };
  }
};

// When a database these relations point at changes (renamed rows, say), load its names again
const relationTargetsChangedAt = computed(() => {
  const targets = [...new Set(fields.value.map((field) => getRelationConfig(field)?.pageId).filter(Boolean))];
  return Object.fromEntries(targets.map((pageId) => [pageId, workspace.databaseChangedAt?.[pageId] || 0]));
});
watch(relationTargetsChangedAt, (next, previous = {}) => {
  Object.entries(next).forEach(([pageId, changedAt]) => {
    if (changedAt && changedAt !== previous[pageId] && relationOptionsByPageId.value[pageId]) {
      void loadRelationOptions(pageId, { force: true });
    }
  });
});

const primeRelationOptions = (fieldList) => {
  const targets = new Set();
  (fieldList || []).forEach((field) => {
    const relation = getRelationConfig(field);
    if (relation?.pageId) targets.add(relation.pageId);
  });
  targets.forEach((pageId) => {
    void loadRelationOptions(pageId);
  });
};

const getAutoColumnSizing = (fields, rows) => {
  const sizing = {};
  fields.forEach((field, index) => {
    if (!field?.id) return;
    if (isAssetTagField(field)) {
      sizing[field.id] = ASSET_TAG_COLUMN_SIZE;
      return;
    }
    let maxChars = 0;
    let maxExtra = 0;
    const isSelect = field.type === 'SELECT';
    const isRelation = field.type === 'RELATION';
    const isMultiSelect = field.type === 'MULTI_SELECT';
    if (isSelect || isRelation) {
      maxChars = (isRelation ? AUTO_SIZE_RELATION_PLACEHOLDER : AUTO_SIZE_SELECT_PLACEHOLDER).length;
    }
    if (isMultiSelect) {
      const placeholder = isMembersField(field) ? AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER : AUTO_SIZE_MULTI_PLACEHOLDER;
      maxChars = placeholder.length;
    }
    for (const row of rows) {
      if (isMultiSelect) {
        const values = getMultiSelectValues(row, field);
        if (!values.length) continue;
        let rowChars = 0;
        let rowPills = 0;
        for (const value of values) {
          const label = getChoiceLabel(field, value);
          if (!label) continue;
          const remaining = AUTO_SIZE_CHAR_LIMIT - rowChars;
          if (remaining <= 0) break;
          rowChars += Math.min(label.length, remaining);
          rowPills += 1;
          if (rowChars >= AUTO_SIZE_CHAR_LIMIT) break;
        }
        if (rowChars > maxChars) {
          maxChars = rowChars;
        }
        if (rowPills) {
          const extra = rowPills * AUTO_SIZE_MULTI_PILL_PADDING + Math.max(0, rowPills - 1) * AUTO_SIZE_MULTI_PILL_GAP;
          if (extra > maxExtra) {
            maxExtra = extra;
          }
        }
        continue;
      }
      const text = stringifyValue(displayValueForField(row, field));
      if (text.length > maxChars) {
        maxChars = text.length;
        if (maxChars >= AUTO_SIZE_CHAR_LIMIT) {
          maxChars = AUTO_SIZE_CHAR_LIMIT;
          break;
        }
      }
    }
    maxChars = Math.min(AUTO_SIZE_CHAR_LIMIT, maxChars);
    if (isSelect || isRelation) {
      maxExtra = Math.max(maxExtra, AUTO_SIZE_SELECT_EXTRA);
    }
    const iconExtra = index === 0 && isPageField(field) ? AUTO_SIZE_PAGE_ICON_EXTRA : 0;
    const padding = AUTO_SIZE_BASE + AUTO_SIZE_BUFFER + (index === 0 ? AUTO_SIZE_FIRST_EXTRA : 0) + iconExtra + maxExtra;
    const rawSize = Math.ceil(maxChars * AUTO_SIZE_CHAR_WIDTH + padding);
    sizing[field.id] = Math.min(COLUMN_MAX_SIZE, Math.max(COLUMN_MIN_SIZE, rawSize));
  });
  return sizing;
};

const openAssetTagPreview = async (value) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return;
  assetTagPreview.value = { open: true, value: text, dataUrl: '', loading: true, error: '' };
  try {
    const dataUrl = await QRCode.toDataURL(text, { margin: 1, scale: 6 });
    assetTagPreview.value = { open: true, value: text, dataUrl, loading: false, error: '' };
  } catch (err) {
    console.warn('Failed to generate asset tag QR', err);
    assetTagPreview.value = { open: true, value: text, dataUrl: '', loading: false, error: 'Failed to generate QR code.' };
  }
};

const closeAssetTagPreview = () => {
  assetTagPreview.value = { open: false, value: '', dataUrl: '', loading: false, error: '' };
};

const rowPageOverrides = computed(() => {
  const map = new Map();
  const snapshot = lastLoadedSnapshot.value;
  if (!snapshot?.rows?.length) return map;
  snapshot.rows.forEach((row) => {
    if (row?.pageId) {
      map.set(row.id, row.pageId);
    }
  });
  return map;
});

const rowPageId = (row) => row?.pageId || rowPageOverrides.value.get(row?.id) || row?.data?.__pageId || null;
const resolveRowPage = (row) => {
  const pageId = rowPageId(row);
  if (!pageId) return null;
  return pageMap.value.get(pageId) || null;
};

const getRowPageTitle = (row, field) => {
  if (field?.id && row?.data && typeof row.data === 'object') {
    const raw = row.data[field.id];
    if (typeof raw === 'string') return raw;
    if (raw !== null && raw !== undefined) return String(raw);
  }
  const page = resolveRowPage(row);
  if (page?.title) return page.title;
  return '';
};

const resolveRowLastEdited = (row) => {
  const rowUpdated = row?.updatedAt ? new Date(row.updatedAt) : null;
  const page = resolveRowPage(row);
  const pageUpdated = page?.updatedAt ? new Date(page.updatedAt) : null;
  const rowValid = rowUpdated && !Number.isNaN(rowUpdated.getTime()) ? rowUpdated : null;
  const pageValid = pageUpdated && !Number.isNaN(pageUpdated.getTime()) ? pageUpdated : null;
  if (rowValid && pageValid) {
    return pageValid > rowValid ? pageValid : rowValid;
  }
  return rowValid || pageValid || null;
};

const syncRowTitleFromPage = (pageId, title) => {
  const fieldId = pageTitleFieldId.value;
  if (!pageId || !fieldId) return;
  const nextTitle = typeof title === 'string' ? title : title == null ? '' : String(title);
  const changedRowIds = [];
  rows.value.forEach((row) => {
    if (rowPageId(row) !== pageId) return;
    const data = row?.data && typeof row.data === 'object' ? { ...row.data } : {};
    if (data[fieldId] === nextTitle) return;
    data[fieldId] = nextTitle;
    row.data = data;
    changedRowIds.push(row.id);
  });
  if (!changedRowIds.length) return;
  scheduleSortRefresh();
  if (!isCollabEnabled.value) return;
  whenCollabSynced(() => {
    ensureCollabDoc().transact(() => {
      changedRowIds.forEach((rowId) => {
        const dataMap = ensureCollabRowDataMap(ensureCollabRowMap(rowId));
        dataMap?.set(fieldId, nextTitle);
      });
    }, 'db-row-title-sync');
  });
};

const handlePageTitleUpdated = (event) => {
  const pageId = event?.detail?.pageId;
  if (!pageId) return;
  syncRowTitleFromPage(pageId, event?.detail?.title ?? '');
};

const applyRowDataUpdate = (rowId, nextData) => {
  if (!rowId) return;
  const row = rows.value.find((item) => item.id === rowId);
  if (!row) return;
  const data = nextData && typeof nextData === 'object' ? { ...nextData } : {};
  row.data = data;
  row.updatedAt = new Date().toISOString();
  scheduleSortRefresh();
  if (!isCollabEnabled.value) return;
  whenCollabSynced(() => {
    const rowMap = ensureCollabRowMap(rowId);
    const dataMap = ensureCollabRowDataMap(rowMap);
    if (!rowMap || !dataMap) return;
    ensureCollabDoc().transact(() => {
      Array.from(dataMap.keys()).forEach((key) => dataMap.delete(key));
      Object.entries(data).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
    }, 'db-row-props');
  });
};

const handleRowPropertiesUpdated = (event) => {
  const detail = event?.detail;
  if (!detail || detail.databasePageId !== props.pageId) return;
  applyRowDataUpdate(detail.rowId, detail.data);
};

const applyLocalPageTitleUpdate = (pageId, title) => {
  if (!pageId) return;
  const nextTitle = typeof title === 'string' ? title : title == null ? '' : String(title);
  const now = new Date().toISOString();
  workspace.markPendingTitle(pageId, nextTitle);
  workspace.updatePageInLists(pageId, (page) => ({ ...page, title: nextTitle, updatedAt: now }));
  emitPageTitleUpdated(pageId, nextTitle);
};

const schedulePageTitleUpdate = (pageId, title) => {
  if (!pageId) return;
  if (!hasApi.value) return;
  if (isReadonly.value) return;
  if (!activeUser.value) return;
  const nextTitle = typeof title === 'string' ? title : title == null ? '' : String(title);
  const existing = pageTitleUpdateTimers.get(pageId);
  const started = existing?.started || workspace.beginSaving();
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(async () => {
    pageTitleUpdateTimers.delete(pageId);
    try {
      const res = await api.updatePageTitle(
        pageId,
        nextTitle,
        { userId: activeUser.value?.id, userName: activeUser.value?.name }
      );
      if (res) {
        workspace.upsertPage(res);
        workspace.clearPendingTitle(pageId, res.title ?? nextTitle);
        emitPageTitleUpdated(pageId, res.title ?? nextTitle);
      }
    } catch (err) {
      console.warn('Update page title failed', err);
    } finally {
      workspace.finishSaving(started);
    }
  }, 300);
  pageTitleUpdateTimers.set(pageId, { timer, started, title: nextTitle });
};

const flushPageTitleUpdates = () => {
  if (!pageTitleUpdateTimers.size) return;
  pageTitleUpdateTimers.forEach(({ timer, started, title }, pageId) => {
    clearTimeout(timer);
    if (!hasApi.value || isReadonly.value || !activeUser.value) {
      if (started) {
        workspace.finishSaving(started);
      }
      return;
    }
    const nextTitle = typeof title === 'string' ? title : title == null ? '' : String(title);
    api
      .updatePageTitle(
        pageId,
        nextTitle,
        { userId: activeUser.value?.id, userName: activeUser.value?.name }
      )
      .then((res) => {
        if (res) {
          workspace.upsertPage(res);
          workspace.clearPendingTitle(pageId, res.title ?? nextTitle);
          emitPageTitleUpdated(pageId, res.title ?? nextTitle);
        }
      })
      .catch((err) => {
        console.warn('Update page title failed', err);
      })
      .finally(() => {
        workspace.finishSaving(started);
      });
  });
  pageTitleUpdateTimers.clear();
};

const memberChoiceList = computed(() =>
  workspaceMembers.value.map((member) => ({
    value: member.id,
    label: member.name,
    color: colorFromId(member.id),
  }))
);

const getFieldChoices = (field) => {
  if (isMembersField(field)) {
    return memberChoiceList.value;
  }
  return normalizeFieldOptions(field).choices;
};

const getChoiceLabel = (field, value) => {
  if (!value) return '';
  if (field?.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (relation?.pageId) {
      const match = relationOptionsForPage(relation.pageId).find((option) => option.id === value);
      return match?.label || match?.id || String(value);
    }
    return String(value);
  }
  const choices = getFieldChoices(field);
  const match = choices.find((choice) => choice.value === value);
  if (match?.label) return match.label;
  if (isMembersField(field)) {
    return membersMap.value.get(value) || value;
  }
  return match?.value || String(value);
};

// The linked row's current name; the one stored with the link (from when it was made) only when
// the row can't be looked up (not loaded yet, gone, or in a database this person can't open)
const getRelationLabel = (field, entry) => {
  if (!entry) return '';
  const relation = getRelationConfig(field);
  if (relation?.pageId) {
    const match = relationOptionsForPage(relation.pageId).find((option) => option.id === entry.id);
    if (match?.label) return match.label;
  }
  return entry.label || entry.id || '';
};

const getRelationDisplayValue = (row, field) => {
  const entries = getRelationEntries(row, field);
  if (!entries.length) return '';
  const labels = entries.map((entry) => getRelationLabel(field, entry));
  const relation = getRelationConfig(field);
  if (relation?.allowMultiple) return labels;
  return labels[0] || '';
};

const normalizeRelationCellValue = (field, rawValue) => {
  const relation = getRelationConfig(field);
  if (!relation) return null;
  const normalizeValue = (value) => {
    if (!value) return null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entry = normalizeRelationEntry(value);
      if (!entry) return null;
      return entry;
    }
    const id = String(value ?? '').trim();
    if (!id) return null;
    const match = relationOptionsForPage(relation.pageId).find((option) => option.id === id);
    return { id, label: match?.label || '' };
  };
  if (relation.allowMultiple) {
    const list = Array.isArray(rawValue) ? rawValue : [rawValue];
    const entries = list.map((entry) => normalizeValue(entry)).filter(Boolean);
    return entries.length ? entries : null;
  }
  return normalizeValue(rawValue);
};

const displayValueForField = (row, field) => {
  if (isAssetTagField(field)) {
    return getAssetTagValue(row, field);
  }
  if (isPageField(field)) {
    return getRowPageTitle(row, field);
  }
  if (isLastEditedField(field)) {
    const date = resolveRowLastEdited(row);
    return date ? date.toISOString() : '';
  }
  if (field.type === 'MULTI_SELECT') {
    return getMultiSelectValues(row, field).map((value) => getChoiceLabel(field, value));
  }
  if (field.type === 'RELATION') {
    return getRelationDisplayValue(row, field);
  }
  // The rows elsewhere linking here, by title: for gallery cards, sorting, filters and sizing
  if (isLinkedFromField(field)) {
    return linkedRowsFor(field.id, row.id).map((entry) => entry.title);
  }
  if (field.type === 'SELECT') {
    return getChoiceLabel(field, valueForField(row, field));
  }
  return valueForField(row, field);
};

const cleanupMultiSelectOptions = (field, nextOptions, options = {}) => {
  if (!field || field.type !== 'MULTI_SELECT') return;
  if (isMembersField(field)) return;
  const allowedValues = new Set(getMultiSelectChoiceValues(nextOptions || {}));
  let changed = false;
  if (rows.value.length) {
    rows.value.forEach((row) => {
      const current = getMultiSelectValues(row, field);
      if (!current.length) return;
      const next = pruneMultiSelectValues(current, allowedValues);
      if (next.length === current.length) return;
      changed = true;
      const data = row?.data && typeof row.data === 'object' ? { ...row.data } : {};
      if (!next.length) {
        delete data[field.id];
      } else {
        data[field.id] = next;
      }
      row.data = data;
      if (!isCollabEnabled.value && !options.skipSave) {
        scheduleRowUpdate(row, data);
      }
    });
  }
  if (changed) {
    scheduleSortRefresh();
  }
  if (!isCollabEnabled.value || options.skipCollab) return;
  whenCollabSynced(() => {
    const doc = ensureCollabDoc();
    const rowsMap = collabRowsMap.value || doc.getMap('rows');
    collabRowsMap.value = rowsMap;
    doc.transact(() => {
      rowsMap.forEach((entry) => {
        if (!(entry instanceof Y.Map)) return;
        const dataMap = ensureCollabRowDataMap(entry);
        if (!dataMap) return;
        const raw = dataMap.get(field.id);
        const current = getMultiSelectValuesFromRaw(raw);
        if (!current.length) return;
        const next = pruneMultiSelectValues(current, allowedValues);
        if (next.length === current.length) return;
        if (!next.length) {
          dataMap.delete(field.id);
        } else {
          dataMap.set(field.id, next);
        }
      });
    }, 'db-option-cleanup');
  });
};

// Queue of pending ensureRowPage calls deferred while focus is in the table.
const pendingEnsureRowPages = [];
const flushPendingEnsureRowPages = () => {
  while (pendingEnsureRowPages.length) {
    const { row, options } = pendingEnsureRowPages.shift();
    if (!rowPageId(row)) {
      ensureRowPage(row, options);
    }
  }
};

const ensureRowPage = async (row, options = {}) => {
  const rowId = row?.id;
  if (!rowId) return null;
  const existingId = rowPageId(row);
  if (existingId) {
    return pageMap.value.get(existingId) || null;
  }
  if (!hasApi.value || !activeUser.value) return null;
  if (rowPageEnsuring.has(rowId)) return null;
  rowPageEnsuring.add(rowId);
  try {
    const res = await api.ensureDatabaseRowPage(
      rowId,
      { title: options.title, pageId: props.pageId, data: row?.data },
      { userId: activeUser.value.id, userName: activeUser.value.name }
    );
    const payload = res && res.row ? res : { row: res };
    const nextRow = payload?.row;
    const page = payload?.page || null;
    if (nextRow?.data && typeof nextRow.data === 'object') {
      if (!row.data || typeof row.data !== 'object') row.data = {};
      for (const [k, v] of Object.entries(nextRow.data)) {
        row.data[k] = v;
      }
      if (isCollabEnabled.value) {
        whenCollabSynced(() => {
          const rowMap = ensureCollabRowMap(rowId);
          const dataMap = ensureCollabRowDataMap(rowMap);
          if (dataMap && nextRow.data.__pageId) {
            dataMap.set('__pageId', nextRow.data.__pageId);
          }
        });
      }
    }
    if (nextRow?.pageId) {
      row.pageId = nextRow.pageId;
      if (isCollabEnabled.value) {
        whenCollabSynced(() => {
          const rowMap = ensureCollabRowMap(rowId);
          const doc = ensureCollabDoc();
          if (rowMap && doc) {
            doc.transact(() => {
              rowMap.set('pageId', nextRow.pageId);
            }, 'db-row-page');
          }
        });
      }
    }
    if (nextRow?.updatedAt) {
      row.updatedAt = nextRow.updatedAt;
    }
    if (page) {
      workspace.upsertPage(page);
      return page;
    }
    if (nextRow?.pageId) {
      return pageMap.value.get(nextRow.pageId) || null;
    }
    return null;
  } catch (err) {
    console.warn('Ensure row page failed', err);
    error.value = err?.message || 'Failed to create page';
    return null;
  } finally {
    rowPageEnsuring.delete(rowId);
  }
};

const activeField = computed(() => {
  if (!fieldMenu.value.fieldId) return null;
  return fields.value.find((field) => field.id === fieldMenu.value.fieldId) || null;
});

const activeMultiSelectField = computed(() => {
  if (!multiSelectMenu.value.fieldId) return null;
  return fields.value.find((field) => field.id === multiSelectMenu.value.fieldId) || null;
});

const activeMultiSelectRow = computed(() => {
  if (!multiSelectMenu.value.rowId) return null;
  return rows.value.find((row) => row.id === multiSelectMenu.value.rowId) || null;
});

const activeRowMenuRow = computed(() => {
  if (!rowMenu.value.rowId) return null;
  return rows.value.find((row) => row.id === rowMenu.value.rowId) || null;
});

const activeMultiSelectValues = computed(() => {
  const field = activeMultiSelectField.value;
  const row = activeMultiSelectRow.value;
  // A single relation's picker uses the same menu, with its one value
  if (field?.type === 'RELATION' && !getRelationConfig(field)?.allowMultiple) {
    return getRelationEntries(row, field).map((entry) => entry.id).filter(Boolean);
  }
  return getMultiSelectValues(row, field);
});

const activeMultiSelectChoices = computed(() => {
  const field = activeMultiSelectField.value;
  if (!field) return [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation?.pageId) return [];
    return relationOptionsForPage(relation.pageId).map((option) => ({
      value: option.id,
      label: option.label || option.id,
      color: null,
    }));
  }
  return getFieldChoices(field);
});
const activeMultiSelectRelation = computed(() => {
  const field = activeMultiSelectField.value;
  if (!field || field.type !== 'RELATION') return null;
  return getRelationConfig(field);
});
const activeMultiSelectRelationLoading = computed(() => {
  const relation = activeMultiSelectRelation.value;
  if (!relation?.pageId) return false;
  return relationOptionsLoadingForPage(relation.pageId);
});
const activeMultiSelectRelationError = computed(() => {
  const relation = activeMultiSelectRelation.value;
  if (!relation?.pageId) return '';
  return relationOptionsErrorForPage(relation.pageId);
});

const needsMembers = computed(() => fields.value.some((field) => isMembersField(field)));
const hasViewConfig = computed(() => !!activeSavedView.value || Array.isArray(props.hiddenFieldIds));
const viewHiddenFieldIds = computed(() =>
  activeSavedView.value
    ? activeSavedView.value.config?.hiddenFieldIds || []
    : Array.isArray(props.hiddenFieldIds)
      ? props.hiddenFieldIds
      : []
);
const hiddenFieldIdSet = computed(() => new Set(viewHiddenFieldIds.value));
const visibleFieldIds = computed(() =>
  fields.value.map((field) => field.id).filter((fieldId) => !hiddenFieldIdSet.value.has(fieldId))
);
// A saved view rendered inside an inline embed is a read-only linked view — its
// filters/sorts/columns come from the source view and aren't edited here.
const isEmbeddedSavedView = computed(() => props.embedded && !!activeSavedView.value);
const canConfigureView = computed(() => hasViewConfig.value && !isReadonly.value && !isEmbeddedSavedView.value);

const activeFieldIndex = computed(() => fields.value.findIndex((field) => field.id === fieldMenu.value.fieldId));
const activeFieldPlaceholder = computed(() => {
  if (activeFieldIndex.value >= 0) return `Column ${activeFieldIndex.value + 1}`;
  return 'Column';
});

const menuStyle = computed(() => ({
  top: `${fieldMenu.value.y}px`,
  left: `${fieldMenu.value.x}px`,
}));

const addFieldMenuStyle = computed(() => ({
  top: `${addFieldMenu.value.y}px`,
  left: `${addFieldMenu.value.x}px`,
}));

const multiSelectMenuStyle = computed(() => ({
  top: `${multiSelectMenu.value.y}px`,
  left: `${multiSelectMenu.value.x}px`,
}));

const rowMenuStyle = computed(() => ({
  top: `${rowMenu.value.y}px`,
  left: `${rowMenu.value.x}px`,
}));

const columnsMenuStyle = computed(() => ({
  top: `${columnsMenu.value.y}px`,
  left: `${columnsMenu.value.x}px`,
}));

const formMenuStyle = computed(() => ({
  top: `${formMenu.value.y}px`,
  left: `${formMenu.value.x}px`,
}));

const toolbarTeleportTarget = computed(() => props.toolbarTeleportTo || null);

const addFieldPlaceholder = computed(() => `Column ${fields.value.length + 1}`);

const optionDependencyWarnings = computed(() => {
  const field = activeField.value;
  if (!field || !isSelectField(field)) return [];
  if (optionsDraftFieldId.value !== field.id) return [];
  const draftValues = optionsDraft.value
    .map((choice) => String(choice?.value ?? '').trim())
    .filter(Boolean);
  const draftSet = new Set(draftValues);
  const issues = new Map();
  formViews.value.forEach((form) => {
    if (!form) return;
    const formName = typeof form.name === 'string' && form.name.trim() ? form.name.trim() : 'Form';
    const filter = form.config?.filter;
    if (filter && filter.fieldId === field.id && (filter.op === 'equals' || filter.op === 'notEquals')) {
      normalizeFilterValues(filter.value).forEach((value) => {
        if (!value || draftSet.has(value)) return;
        const entry = issues.get(value) || { value, forms: new Set(), reasons: new Set() };
        entry.forms.add(formName);
        entry.reasons.add('filter');
        issues.set(value, entry);
      });
    }
    (form.fields || []).forEach((entry) => {
      const requiredWhen = entry?.requiredWhen;
      if (!requiredWhen || requiredWhen.fieldId !== field.id) return;
      if (requiredWhen.op !== 'equals') return;
      const value = typeof requiredWhen.value === 'string' ? requiredWhen.value.trim() : '';
      if (!value || draftSet.has(value)) return;
      const record = issues.get(value) || { value, forms: new Set(), reasons: new Set() };
      record.forms.add(formName);
      record.reasons.add('required rule');
      issues.set(value, record);
    });
    (form.fields || []).forEach((entry) => {
      const visibleWhen = entry?.visibleWhen;
      if (!visibleWhen || visibleWhen.fieldId !== field.id) return;
      if (visibleWhen.op !== 'equals') return;
      const value = typeof visibleWhen.value === 'string' ? visibleWhen.value.trim() : '';
      if (!value || draftSet.has(value)) return;
      const record = issues.get(value) || { value, forms: new Set(), reasons: new Set() };
      record.forms.add(formName);
      record.reasons.add('visibility rule');
      issues.set(value, record);
    });
  });
  return Array.from(issues.values()).map((entry) => ({
    value: entry.value,
    formsText: Array.from(entry.forms).join(', '),
    reasonsText: Array.from(entry.reasons).join(', '),
  }));
});

const closeColumnsMenu = () => {
  columnsMenu.value = { open: false, x: 0, y: 0 };
};

const { collabDoc, collabProvider, whenCollabSynced, collabWaiting, collabEverSynced, collabFieldOrder, collabFieldsMap, collabRowOrder, collabRowsMap, ensureCollabDoc, ensureCollabFieldMap, ensureCollabRowMap, isCollabEnabled, maybeSeedCollab, setupCollabProvider, teardownCollabProvider, syncCollabFieldsFromSnapshot, syncCollabRowsFromSnapshot, collabContext } = useDatabaseCollab({ props, workspace, fields, rows, sorting, columnSizing, tableWrapRef, lastLoadedSnapshot, isComplianceDatabase, syncComplianceStatusCache });
// Shown only if the wait lasts, so a normal load doesn't flash it
const showConnectionNotice = ref(false);
let connectionNoticeTimer = null;
watch(
  collabWaiting,
  (waiting) => {
    connectionPaused.value = waiting;
    clearTimeout(connectionNoticeTimer);
    if (!waiting) {
      showConnectionNotice.value = false;
      return;
    }
    connectionNoticeTimer = setTimeout(() => {
      showConnectionNotice.value = true;
    }, 800);
  },
  { immediate: true }
);
onBeforeUnmount(() => clearTimeout(connectionNoticeTimer));
const { attachAwarenessListener, caretLeftForCell, clearLocalCellCursor, getCellPresence, handleCaretMouse, handleCaretNavigate, markCellBlur, markCellFocus, markCellTyping, onTableFocusOut, presenceUser, setCellInputRef, updateAwarenessUser } = useCellPresence({ emit, activeUser, collabProvider, isCollabEnabled, tableWrapRef, flushPendingEnsureRowPages, scheduleSortRefresh });

const { savedViews, normalizeSavedView, createSavedView, deleteSavedView, renameSavedView, patchActiveViewConfig, activeViewFilters, activeViewSorts, activeFilterCount, setFilterMatch, addFilterRule, updateFilterRule, changeFilterRuleField, removeFilterRule, addSortRule, updateSortRule, removeSortRule, setBoardGroupField, setGalleryCardField, setGalleryCardFields, setGalleryCoverMax, fieldChoices, filterMenu, filterMenuRef, filterMenuStyle, openFilterMenu, closeFilterMenu, sortMenu, sortMenuRef, sortMenuStyle, openSortMenu, closeSortMenu } = useSavedViews({ props, workspace, fields, fieldById, activeViewId, activeSavedView, hasApi, activeUser, error, canCreateForms, runWithSavingIndicator, closeFormMenu, closeColumnsMenu, getChoiceLabel, databaseRootRef });

watch(
  () => [fieldMenu.value.open, fieldMenu.value.fieldId],
  ([isOpen]) => {
    if (!isOpen) return;
    fieldNameDraft.value = activeField.value?.name || '';
  }
);

watch(
  [() => fields.value.map((field) => field.id), viewHiddenFieldIds],
  ([fieldIds, hidden]) => {
    if (!hasViewConfig.value) return;
    if (!fieldIds.length) return;
    const fieldSet = new Set(fieldIds);
    const cleaned = hidden.filter((id) => fieldSet.has(id));
    if (cleaned.length !== hidden.length) {
      emit('update:hiddenFieldIds', cleaned);
    }
  }
);

const setOptionsDraftForField = (field) => {
  if (isFieldOptionsLocked(field) || isFieldReadOnly(field)) return;
  optionsDraft.value = normalizeFieldOptions(field).choices.map((choice) => ({
    value: choice.value,
    color: choice.color || null,
  }));
  optionsDraftFieldId.value = field.id;
};

const setRelationDraftForField = (field) => {
  if (!field) return;
  const relation = getRelationConfig(field);
  relationDraftPageId.value = relation?.pageId || '';
  relationDraftFieldId.value = field.id;
  relationDraftAllowMultiple.value = relation?.allowMultiple === true;
  relationDraftHistoryEnabled.value = relation?.history?.enabled === true;
  relationDraftHistoryPageId.value = relation?.history?.pageId || '';
  if (relation?.pageId) {
    void loadRelationOptions(relation.pageId);
  }
};

const updateHiddenFieldIds = (nextIds) => {
  if (!hasViewConfig.value) return;
  const fieldSet = new Set(fields.value.map((field) => field.id));
  const cleaned = Array.from(new Set(nextIds)).filter((id) => fieldSet.has(id));
  if (activeSavedView.value) {
    patchActiveViewConfig({ hiddenFieldIds: cleaned });
    return;
  }
  emit('update:hiddenFieldIds', cleaned);
};

const isHideDisabled = (fieldId) =>
  !hiddenFieldIdSet.value.has(fieldId) && visibleFieldIds.value.length <= 1;

const toggleFieldHidden = (fieldId) => {
  if (!hasViewConfig.value) return;
  const next = new Set(viewHiddenFieldIds.value);
  if (next.has(fieldId)) {
    next.delete(fieldId);
  } else {
    if (visibleFieldIds.value.length <= 1) return;
    next.add(fieldId);
  }
  updateHiddenFieldIds(Array.from(next));
};

const hideFieldFromView = (fieldId) => {
  if (!fieldId || !hasViewConfig.value) return;
  if (visibleFieldIds.value.length <= 1) return;
  if (hiddenFieldIdSet.value.has(fieldId)) return;
  updateHiddenFieldIds([...viewHiddenFieldIds.value, fieldId]);
  closeFieldMenu();
};

const scheduleRowUpdate = (row, data, options = {}) => {
  const rowId = row?.id;
  if (!rowId) return;
  if (isCollabEnabled.value) return;
  if (!hasApi.value) return;
  if (isReadonly.value) return;
  if (!activeUser.value) return;
  const deferSort = options?.deferSort === true;
  const existing = rowSaveTimers.get(rowId);
  const started = existing?.started || workspace.beginSaving();
  if (existing?.timer) {
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(async () => {
    rowSaveTimers.delete(rowId);
    try {
      const res = await api.updateDatabaseRow(rowId, { data }, { userId: activeUser.value?.id, userName: activeUser.value?.name });
      const payload = res && res.row ? res : { row: res };
      const nextRow = payload?.row;
      if (nextRow && row) {
        // Merge server data into existing row in-place to avoid triggering
        // a full re-render that would steal focus from another cell.
        if (nextRow.data && typeof nextRow.data === 'object') {
          if (!row.data || typeof row.data !== 'object') row.data = {};
          for (const [k, v] of Object.entries(nextRow.data)) {
            row.data[k] = v;
          }
        }
        if (nextRow.pageId) {
          row.pageId = nextRow.pageId;
        }
        if (nextRow.updatedAt) {
          row.updatedAt = nextRow.updatedAt;
        }
      }
      if (!deferSort) {
        scheduleSortRefresh();
      }
      if (payload?.page) {
        workspace.upsertPage(payload.page);
      }
    } catch (err) {
      console.warn('Update row failed', err);
      error.value = err?.message || 'Failed to update row';
    } finally {
      workspace.finishSaving(started);
    }
  }, 250);
  rowSaveTimers.set(rowId, { timer, started });
};

const updateCell = (row, field, rawValue, options = {}) => {
  if (isReadonly.value) return;
  if (isFieldReadOnly(field)) return;
  const useRaw = options?.raw === true && field?.type === 'NUMBER';
  const shouldDeferSort = options?.deferSort === true;
  const value =
    field?.type === 'RELATION'
      ? normalizeRelationCellValue(field, rawValue)
      : useRaw
      ? rawValue
      : normalizeCellValue(field, rawValue);
  const clearing = shouldClearCell(value);
  // Mutate row.data in place rather than replacing the object.
  // Replacing with a new object triggers TanStack to regenerate its row model,
  // causing FlexRender to recreate cell DOM elements and steal focus.
  if (!row.data || typeof row.data !== 'object') {
    row.data = {};
  }
  if (isCollabEnabled.value) {
    const rowId = row?.id;
    const fieldId = field?.id;
    if (!rowId || !fieldId) return;
    whenCollabSynced(() => {
      const rowMap = ensureCollabRowMap(rowId);
      const dataMap = ensureCollabRowDataMap(rowMap);
      if (!rowMap || !dataMap) return;
      ensureCollabDoc().transact(() => {
        if (clearing) {
          dataMap.delete(fieldId);
        } else {
          dataMap.set(fieldId, value);
        }
      }, 'db-cell-update');
    });
    if (clearing) {
      delete row.data[fieldId];
    } else {
      row.data[fieldId] = value;
    }
    if (!shouldDeferSort) {
      scheduleSortRefresh();
    }
    if (isPageField(field) && !shouldDeferSort) {
      const pageId = rowPageId(row);
      const nextTitle = clearing ? '' : value;
      if (pageId) {
        applyLocalPageTitleUpdate(pageId, nextTitle);
        schedulePageTitleUpdate(pageId, nextTitle);
      }
    }
    return;
  }
  if (clearing) {
    delete row.data[field.id];
  } else {
    row.data[field.id] = value;
  }
  if (!shouldDeferSort) {
    scheduleSortRefresh();
  }
  scheduleRowUpdate(row, { ...row.data }, { deferSort: shouldDeferSort });
  if (isPageField(field) && !shouldDeferSort) {
    const pageId = rowPageId(row);
    const nextTitle = clearing ? '' : value;
    if (pageId) {
      applyLocalPageTitleUpdate(pageId, nextTitle);
    }
  }
};

const closeFieldMenu = () => {
  fieldMenu.value = { open: false, fieldId: null, x: 0, y: 0 };
  panelState.value = 'root';
  menuDir.value = 'forward';
  fieldNameDraft.value = '';
  optionsDraft.value = [];
  optionsDraftFieldId.value = null;
  relationDraftPageId.value = '';
  relationDraftFieldId.value = null;
  relationDraftAllowMultiple.value = false;
  relationDraftHistoryEnabled.value = false;
  relationDraftHistoryPageId.value = '';
};

const closeAddFieldMenu = () => {
  addFieldMenu.value = { open: false, x: 0, y: 0 };
  addFieldLinkedFromChoices.value = null;
  addFieldName.value = '';
};

const closeMultiSelectMenu = () => {
  multiSelectMenu.value = { open: false, fieldId: null, rowId: null, x: 0, y: 0 };
};

const closeRowMenu = () => {
  rowMenu.value = { open: false, rowId: null, x: 0, y: 0 };
};

const openFieldMenu = (fieldId, event) => {
  if (!fieldId || !event) return;
  if (fieldId === ROW_ID_COLUMN_ID) return;
  if (isReadonly.value) return;
  if (fieldMenu.value.open && fieldMenu.value.fieldId && fieldMenu.value.fieldId !== fieldId) {
    commitFieldName();
    commitFieldOptions();
    commitRelationOptions();
  }
  closeRowMenu();
  closeMultiSelectMenu();
  closeAddFieldMenu();
  closeColumnsMenu();
  closeFormMenu();
  const isSame = fieldMenu.value.open && fieldMenu.value.fieldId === fieldId;
  if (isSame) {
    commitFieldName();
    commitFieldOptions();
    commitRelationOptions();
    closeFieldMenu();
    return;
  }
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
  const rootLeft = rootRect?.left ?? 0;
  const rootTop = rootRect?.top ?? 0;
  let x = (rect?.left ?? event.clientX ?? 0) - rootLeft;
  let y = (rect?.bottom ?? event.clientY ?? 0) - rootTop;
  y += 6;
  if (typeof window !== 'undefined') {
    const padding = 12;
    const menuWidth = 240;
    const menuHeight = 260;
    const minX = padding - rootLeft;
    const minY = padding - rootTop;
    const maxX = window.innerWidth - menuWidth - rootLeft - padding;
    const maxY = window.innerHeight - menuHeight - rootTop - padding;
    x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
    y = Math.min(Math.max(y, minY), Math.max(minY, maxY));
  }
  fieldMenu.value = { open: true, fieldId, x, y };
  panelState.value = 'root';
  menuDir.value = 'forward';
};

const openAddFieldMenu = async (event) => {
  if (!event) return;
  if (isReadonly.value) return;
  if (addFieldMenu.value.open) {
    closeAddFieldMenu();
    return;
  }
  closeRowMenu();
  closeMultiSelectMenu();
  closeFieldMenu();
  closeColumnsMenu();
  closeFormMenu();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
  const rootLeft = rootRect?.left ?? 0;
  const rootTop = rootRect?.top ?? 0;
  const anchorX = (rect?.left ?? event.clientX ?? 0) - rootLeft;
  const anchorRight = (rect?.right ?? event.clientX ?? 0) - rootLeft;
  const anchorY = (rect?.bottom ?? event.clientY ?? 0) - rootTop + 6;
  let x = anchorX;
  let y = anchorY;
  addFieldMenu.value = { open: true, x, y };
  addFieldName.value = '';
  await nextTick();
  if (typeof window !== 'undefined' && addFieldMenuRef.value) {
    const padding = 12;
    const bounds = addFieldMenuRef.value.getBoundingClientRect();
    const maxX = window.innerWidth - bounds.width - rootLeft - padding;
    const maxY = window.innerHeight - bounds.height - rootTop - padding;
    const minX = padding - rootLeft;
    const minY = padding - rootTop;
    let nextX = Math.min(Math.max(minX, x), Math.max(minX, maxX));
    let nextY = Math.min(Math.max(minY, y), Math.max(minY, maxY));
    const rightLimit = window.innerWidth - rootLeft - padding;
    const bottomLimit = window.innerHeight - rootTop - padding;
    if (anchorX + bounds.width > rightLimit) {
      const alignRight = anchorRight - bounds.width;
      nextX = Math.min(Math.max(minX, alignRight), Math.max(minX, maxX));
    }
    const canFlipUp = anchorY - bounds.height - 8 >= minY;
    if (anchorY + bounds.height > bottomLimit && canFlipUp) {
      nextY = anchorY - bounds.height - 8;
    }
    if (nextX !== x || nextY !== y) {
      addFieldMenu.value = { open: true, x: nextX, y: nextY };
    }
  }
  addFieldNameRef.value?.focus?.();
};

const openMultiSelectMenu = (row, field, event) => {
  if (!row || !field || !event) return;
  const relation = field.type === 'RELATION' ? getRelationConfig(field) : null;
  if (field.type !== 'MULTI_SELECT' && !relation?.pageId) return;
  if (relation?.pageId) void loadRelationOptions(relation.pageId);
  if (isReadonly.value) return;
  if (isFieldReadOnly(field)) return;
  const isSame =
    multiSelectMenu.value.open && multiSelectMenu.value.fieldId === field.id && multiSelectMenu.value.rowId === row.id;
  if (isSame) {
    closeMultiSelectMenu();
    return;
  }
  commitFieldName();
  commitFieldOptions();
  commitRelationOptions();
  closeRowMenu();
  closeFieldMenu();
  closeAddFieldMenu();
  closeColumnsMenu();
  closeFormMenu();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  let x = rect?.left ?? event.clientX ?? 0;
  let y = rect?.bottom ?? event.clientY ?? 0;
  y += 6;
  if (typeof window !== 'undefined') {
    const padding = 12;
    const maxX = window.innerWidth - 240;
    const maxY = window.innerHeight - 260;
    if (x > maxX) x = Math.max(padding, maxX);
    if (y > maxY) y = Math.max(padding, maxY);
  }
  multiSelectMenu.value = { open: true, fieldId: field.id, rowId: row.id, x, y };
};

const openRowMenu = (row, event) => {
  if (!row?.id || !event) return;
  if (isReadonly.value) return;
  const isSame = rowMenu.value.open && rowMenu.value.rowId === row.id;
  if (isSame) {
    closeRowMenu();
    return;
  }
  commitFieldName();
  commitFieldOptions();
  commitRelationOptions();
  closeFieldMenu();
  closeAddFieldMenu();
  closeMultiSelectMenu();
  closeColumnsMenu();
  closeFormMenu();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
  const rootLeft = rootRect?.left ?? 0;
  const rootTop = rootRect?.top ?? 0;
  let x = (rect?.left ?? event.clientX ?? 0) - rootLeft;
  let y = (rect?.bottom ?? event.clientY ?? 0) - rootTop;
  y += 6;
  if (typeof window !== 'undefined') {
    const padding = 12;
    const menuWidth = 220;
    const menuHeight = 200;
    const minX = padding - rootLeft;
    const minY = padding - rootTop;
    const maxX = window.innerWidth - menuWidth - rootLeft - padding;
    const maxY = window.innerHeight - menuHeight - rootTop - padding;
    x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
    y = Math.min(Math.max(y, minY), Math.max(minY, maxY));
  }
  rowMenu.value = { open: true, rowId: row.id, x, y };
};

const openColumnsMenu = async (event) => {
  if (!event || !hasViewConfig.value) return;
  if (isReadonly.value) return;
  if (columnsMenu.value.open) {
    closeColumnsMenu();
    return;
  }
  commitFieldName();
  commitFieldOptions();
  commitRelationOptions();
  closeRowMenu();
  closeFieldMenu();
  closeAddFieldMenu();
  closeMultiSelectMenu();
  closeFormMenu();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
  const rootLeft = rootRect?.left ?? 0;
  const rootTop = rootRect?.top ?? 0;
  let x = (rect?.left ?? event.clientX ?? 0) - rootLeft;
  let y = (rect?.bottom ?? event.clientY ?? 0) - rootTop;
  y += 6;
  columnsMenu.value = { open: true, x, y };
  await nextTick();
  if (typeof window !== 'undefined' && columnsMenuRef.value) {
    const padding = 12;
    const bounds = columnsMenuRef.value.getBoundingClientRect();
    const maxX = window.innerWidth - bounds.width - rootLeft - padding;
    const maxY = window.innerHeight - bounds.height - rootTop - padding;
    const minX = padding - rootLeft;
    const minY = padding - rootTop;
    const nextX = Math.min(Math.max(minX, x), Math.max(minX, maxX));
    const nextY = Math.min(Math.max(minY, y), Math.max(minY, maxY));
    if (nextX !== x || nextY !== y) {
      columnsMenu.value = { open: true, x: nextX, y: nextY };
    }
  }
};

const openPanel = (next) => {
  menuDir.value = next === 'root' ? 'backward' : 'forward';
  panelState.value = next;
};

const handleFieldMenuOutside = (event) => {
  if (
    !fieldMenu.value.open
    && !addFieldMenu.value.open
    && !multiSelectMenu.value.open
    && !columnsMenu.value.open
    && !formMenu.value.open
    && !filterMenu.value.open
    && !sortMenu.value.open
  ) return;
  const target = event?.target;
  if (target?.closest?.('.db-header-button')) return;
  if (target?.closest?.('.db-add-column-btn')) return;
  if (target?.closest?.('.db-multi-cell')) return;
  if (target?.closest?.('.db-columns-button')) return;
  if (target?.closest?.('.db-form-button')) return;
  if (target?.closest?.('.db-filter-menu-button')) return;
  if (target?.closest?.('.db-sort-menu-button')) return;
  if (fieldMenuRef.value?.contains(target)) return;
  if (addFieldMenuRef.value?.contains(target)) return;
  if (multiSelectMenuRef.value?.contains(target)) return;
  if (columnsMenuRef.value?.contains(target)) return;
  if (formMenuRef.value?.contains(target)) return;
  if (filterMenuRef.value?.contains(target)) return;
  if (sortMenuRef.value?.contains(target)) return;
  if (fieldMenu.value.open) {
    commitFieldName();
    commitFieldOptions();
    commitRelationOptions();
  }
  closeFieldMenu();
  closeAddFieldMenu();
  closeMultiSelectMenu();
  closeColumnsMenu();
  closeFormMenu();
  closeFilterMenu();
  closeSortMenu();
};

const handleFieldMenuKeydown = (event) => {
  if (
    !fieldMenu.value.open
    && !addFieldMenu.value.open
    && !multiSelectMenu.value.open
    && !columnsMenu.value.open
    && !formMenu.value.open
    && !filterMenu.value.open
    && !sortMenu.value.open
  ) return;
  if (event.key === 'Escape') {
    closeFieldMenu();
    closeAddFieldMenu();
    closeMultiSelectMenu();
    closeColumnsMenu();
    closeFormMenu();
    closeFilterMenu();
    closeSortMenu();
  }
};

// A saved view's own menu (the ⋯ beside its tab, or a right-click on the tab): rename or delete it
const viewMenu = ref({ open: false, viewId: null, x: 0, y: 0 });
const viewMenuRef = ref(null);
const viewMenuView = computed(() => savedViews.value.find((view) => view.id === viewMenu.value.viewId) || null);
const viewMenuStyle = computed(() => ({ top: `${viewMenu.value.y}px`, left: `${viewMenu.value.x}px` }));
const closeViewMenu = () => {
  viewMenu.value = { open: false, viewId: null, x: 0, y: 0 };
};
const openViewMenu = (view, event) => {
  if (!view || !event || !canCreateForms.value) return;
  if (viewMenu.value.open && viewMenu.value.viewId === view.id) {
    closeViewMenu();
    return;
  }
  closeFilterMenu();
  closeSortMenu();
  closeFormMenu();
  closeColumnsMenu();
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const rootRect = databaseRootRef.value?.getBoundingClientRect?.();
  const padding = 12;
  const menuWidth = 200;
  const left = Math.min(rect?.left ?? event.clientX ?? 0, window.innerWidth - menuWidth - padding);
  const top = (rect?.bottom ?? event.clientY ?? 0) + 6;
  viewMenu.value = { open: true, viewId: view.id, x: left - (rootRect?.left ?? 0), y: top - (rootRect?.top ?? 0) };
};
const renameViewFromMenu = () => {
  const view = viewMenuView.value;
  closeViewMenu();
  renameSavedView(view);
};
const deleteViewFromMenu = () => {
  const view = viewMenuView.value;
  closeViewMenu();
  deleteSavedView(view);
};
const handleViewMenuOutside = (event) => {
  if (!viewMenu.value.open) return;
  const target = event?.target;
  if (viewMenuRef.value?.contains(target) || target?.closest?.('.db-view-tab__more')) return;
  closeViewMenu();
};
const handleViewMenuKeydown = (event) => {
  if (viewMenu.value.open && event.key === 'Escape') closeViewMenu();
};

const handleRowMenuOutside = (event) => {
  if (!rowMenu.value.open) return;
  const target = event?.target;
  if (rowMenuRef.value?.contains(target)) return;
  if (target?.closest?.('.db-row-handle')) return;
  closeRowMenu();
};

const handleRowMenuKeydown = (event) => {
  if (!rowMenu.value.open) return;
  if (event.key === 'Escape') {
    closeRowMenu();
  }
};

const choiceColorForValue = (field, value) => {
  if (!field || !value) return null;
  if (isMembersField(field)) {
    return colorFromId(value);
  }
  const choices = getFieldChoices(field);
  const match = choices.find((choice) => choice.value === value);
  return match?.color || null;
};

const { renderCellInput } = useCellRenderer({ choiceColorForValue, getChoiceLabel, isReadonly, markCellFocus, markCellBlur, openMultiSelectMenu, getCellPresence, caretLeftForCell, openAssetTagPreview, rowPageId, getRowPageTitle, openRowPageOverlay, pageMap, workspace, resolveRowPage, ensureRowPage, applyLocalPageTitleUpdate, schedulePageTitleUpdate, tableWrapRef, pendingEnsureRowPages, scheduleSortRefresh, handleCaretNavigate, handleCaretMouse, markCellTyping, updateCell, setCellInputRef, resolveRowLastEdited, relationOptionsByPageId, relationOptionsLoading, loadRelationOptions, relationOptionsForPage, relationOptionsLoadingForPage, relationOptionsErrorForPage, getFieldChoices, linkedRowsFor, getRelationLabel, openRelatedRow: (field, rowId) => openRelatedRow(field, rowId) });

const getColumnSizeForField = (fieldId) => {
  const raw = columnSizing.value?.[fieldId] ?? COLUMN_DEFAULT_SIZE;
  return Math.min(COLUMN_MAX_SIZE, Math.max(COLUMN_MIN_SIZE, raw));
};

const addColumnSize = computed(() => {
  const containerWidth = tableWrapWidth.value;
  if (!containerWidth) return ADD_COLUMN_SIZE;
  const rowIdSize = columnSizing.value?.[ROW_ID_COLUMN_ID] ?? ROW_ID_COLUMN_SIZE;
  const baseWidth = fields.value.reduce((total, field) => {
    if (!field?.id || hiddenFieldIdSet.value.has(field.id)) return total;
    return total + getColumnSizeForField(field.id);
  }, rowIdSize);
  return Math.max(ADD_COLUMN_SIZE, containerWidth - baseWidth);
});

const columns = computed(() => {
  const rowIdColumn = {
    id: ROW_ID_COLUMN_ID,
    accessorFn: (row) => getRowIdValue(row),
    header: () => ROW_ID_COLUMN_LABEL,
    cell: ({ row }) => renderRowIdCell(row.original),
    sortingFn: (rowA, rowB, columnId) => {
      const a = String(rowA.getValue(columnId) || '');
      const b = String(rowB.getValue(columnId) || '');
      return a.localeCompare(b);
    },
    size: ROW_ID_COLUMN_SIZE,
    minSize: ROW_ID_COLUMN_MIN_SIZE,
    maxSize: COLUMN_MAX_SIZE,
  };
  const baseColumns = fields.value.map((field) => ({
    id: field.id,
    accessorFn: (row) => displayValueForField(row, field),
    header: () => field.name || 'Field',
    cell: ({ row }) => renderCellInput(row.original, field),
    sortingFn: (rowA, rowB, columnId) => sortByType(field.type, rowA.getValue(columnId), rowB.getValue(columnId)),
    size: COLUMN_DEFAULT_SIZE,
    minSize: COLUMN_MIN_SIZE,
    maxSize: COLUMN_MAX_SIZE,
  }));
  const addColumn = {
    id: ADD_COLUMN_ID,
    header: () => ADD_COLUMN_LABEL,
    cell: () => null,
    size: addColumnSize.value,
    minSize: ADD_COLUMN_SIZE,
    maxSize: addColumnSize.value,
    enableSorting: false,
    enableResizing: false,
  };
  return [...(isComplianceDatabase.value ? [rowIdColumn] : []), ...baseColumns, addColumn];
});

const columnVisibility = computed(() => {
  if (!hasViewConfig.value) return {};
  const visibility = {};
  viewHiddenFieldIds.value.forEach((fieldId) => {
    visibility[fieldId] = false;
  });
  return visibility;
});

const tableRows = computed(() => {
  if (!isWikiDatabase.value) return rows.value;
  const homeId = wikiHomeId.value;
  if (!homeId) return rows.value;
  return rows.value.filter((row) => {
    const pageId = rowPageId(row);
    if (!pageId) return false;
    const page = pageMap.value.get(pageId);
    if (!page || page.isDeleted || page.isHidden) return false;
    if (page.kind !== 'DOC') return false;
    if (page.id === homeId) return false;
    return page.wikiHomeId === homeId;
  });
});

const { viewFilteredRows, viewSorting, boardColumns, cardBodyFields, cardFieldCandidates, galleryCardField, galleryCardValue, openRowCard, rowTitle } = useViewRows({ fields, fieldById, tableRows, activeSavedView, isBoardView, hiddenFieldIdSet, displayValueForField, getChoiceLabel, rowPageId, openRowPageOverlay, ensureRowPage, isReadonly, workspace });

// A gallery cover listing linked rows ("Linked from" or a relation): stacked cells that open them,
// as many as the view says before "Show more"
const DEFAULT_COVER_MAX = 3;
const isListCover = computed(() => {
  const field = galleryCardField.value;
  return !!field && (isLinkedFromField(field) || field.type === 'RELATION');
});
const coverMax = computed(() => activeSavedView.value?.config?.coverMaxItems || DEFAULT_COVER_MAX);
const expandedCovers = ref(new Set());
// The rows a "Linked from" or relation value links to, each with how to open it
const linkItemsFor = (row, field) => {
  if (!field) return [];
  if (isLinkedFromField(field)) {
    return linkedRowsFor(field.id, row.id).map((entry) => ({
      key: entry.rowId,
      label: entry.title,
      open: entry.rowPageId ? () => (typeof openRowPageOverlay === 'function' ? openRowPageOverlay(entry.rowPageId) : workspace.loadPageDoc(entry.rowPageId)) : null,
    }));
  }
  return getRelationEntries(row, field)
    .filter((entry) => entry?.id)
    .map((entry) => ({ key: entry.id, label: getRelationLabel(field, entry) || entry.id, open: () => openRelatedRow(field, entry.id) }));
};
const coverItems = (row) => linkItemsFor(row, galleryCardField.value);
const shownCoverItems = (row) => {
  const items = coverItems(row);
  return expandedCovers.value.has(row.id) ? items : items.slice(0, coverMax.value);
};
// The "Show" box saves as you type: saving only on leaving it lost the number when the box was
// redrawn first (a save's reply landing meanwhile put the stored number back). Left empty, it
// shows the number in use again.
const handleCoverMaxInput = (event) => {
  const value = Number.parseInt(event.target.value, 10);
  if (Number.isInteger(value) && value >= 1) setGalleryCoverMax(value);
};
const handleCoverMaxChange = (event) => {
  if (!event.target.value.trim()) event.target.value = String(coverMax.value);
};
const moreCoverItems = (row) => Math.max(0, coverItems(row).length - coverMax.value);
const toggleCoverExpanded = (rowId) => {
  const next = new Set(expandedCovers.value);
  if (next.has(rowId)) next.delete(rowId);
  else next.add(rowId);
  expandedCovers.value = next;
};
// A list view: each row on one line, with the properties chosen for it (none until chosen)
const isLinkField = (field) => isLinkedFromField(field) || field?.type === 'RELATION';
const listFields = computed(() => {
  const chosen = activeSavedView.value?.config?.cardFieldIds;
  return Array.isArray(chosen) ? cardFieldCandidates.value.filter((field) => chosen.includes(field.id)) : [];
});
const listFieldShown = (fieldId) => listFields.value.some((field) => field.id === fieldId);
const toggleListField = (fieldId) => {
  const shown = new Set(listFields.value.map((field) => field.id));
  if (shown.has(fieldId)) shown.delete(fieldId);
  else shown.add(fieldId);
  setGalleryCardFields(cardFieldCandidates.value.map((field) => field.id).filter((id) => shown.has(id)));
};
const rowIcon = (row) => {
  const pageId = rowPageId(row);
  return (pageId && pageMap.value.get(pageId)?.icon) || row?.icon || '';
};

// Ticking which columns the cards show (once changed, the cards keep their own list)
const cardFieldShown = (fieldId) => cardBodyFields.value.some((field) => field.id === fieldId);
const toggleCardField = (fieldId) => {
  const shown = new Set(cardBodyFields.value.map((field) => field.id));
  if (shown.has(fieldId)) shown.delete(fieldId);
  else shown.add(fieldId);
  setGalleryCardFields(cardFieldCandidates.value.map((field) => field.id).filter((id) => shown.has(id)));
};

const table = useVueTable({
  get data() {
    return viewFilteredRows.value;
  },
  get columns() {
    return columns.value;
  },
  state: {
    get sorting() {
      return activeSavedView.value ? viewSorting.value : sorting.value;
    },
    get globalFilter() {
      return globalFilter.value;
    },
    get columnSizing() {
      return columnSizing.value;
    },
    get columnSizingInfo() {
      return columnSizingInfo.value;
    },
    get columnVisibility() {
      return columnVisibility.value;
    },
  },
  onSortingChange: (updater) => {
    // When a saved view is active, header-click sorting edits (and persists)
    // that view's sort config; otherwise it drives the local sort state.
    if (activeSavedView.value) {
      // Linked views inside an embed are read-only — don't mutate the source.
      if (props.embedded) return;
      const current = viewSorting.value;
      const next = typeof updater === 'function' ? updater(current) : updater;
      patchActiveViewConfig({
        sorts: next.map((sort) => ({ fieldId: sort.id, direction: sort.desc ? 'desc' : 'asc' })),
      });
      return;
    }
    sorting.value = typeof updater === 'function' ? updater(sorting.value) : updater;
  },
  onGlobalFilterChange: (updater) => {
    globalFilter.value = typeof updater === 'function' ? updater(globalFilter.value) : updater;
  },
  onColumnSizingChange: (updater) => {
    columnSizing.value = typeof updater === 'function' ? updater(columnSizing.value) : updater;
  },
  onColumnSizingInfoChange: (updater) => {
    columnSizingInfo.value = typeof updater === 'function' ? updater(columnSizingInfo.value) : updater;
  },
  globalFilterFn: (row, columnId, filterValue) => {
    if (!filterValue) return true;
    const needle = String(filterValue).toLowerCase();
    const hay = stringifyValue(row.getValue(columnId)).toLowerCase();
    return hay.includes(needle);
  },
  getCoreRowModel: getCoreRowModel(),
  getFilteredRowModel: getFilteredRowModel(),
  getSortedRowModel: getSortedRowModel(),
  enableColumnResizing: true,
  columnResizeMode: 'onChange',
});

const visibleColumnCount = computed(() => Math.max(1, table.getVisibleLeafColumns().length));
const updateGlobalFilter = (event) => {
  table.setGlobalFilter(event?.target?.value ?? '');
};

const clearGlobalFilter = () => {
  table.setGlobalFilter('');
};

const showFilterInput = computed(() => filterOpen.value || !!globalFilter.value);

const openFilter = async () => {
  filterOpen.value = true;
  await nextTick();
  filterInputRef.value?.focus?.();
};

const closeFilter = () => {
  if (globalFilter.value) return;
  filterOpen.value = false;
};

const handleFilterKeydown = (event) => {
  if (event.key === 'Escape') {
    if (globalFilter.value) {
      clearGlobalFilter();
      return;
    }
    closeFilter();
  }
};

const commitFieldName = async () => {
  if (isReadonly.value) return;
  const field = activeField.value;
  if (!field) return;
  if (isFieldReadOnly(field)) return;
  const trimmed = fieldNameDraft.value.trim();
  const name = trimmed || activeFieldPlaceholder.value;
  if (!name || name === field.name) {
    fieldNameDraft.value = field.name || '';
    return;
  }
  await updateField(field, { name });
  fieldNameDraft.value = name;
};

const handleFieldNameKeydown = (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitFieldName();
    event.currentTarget?.blur?.();
  }
  if (event.key === 'Escape') {
    fieldNameDraft.value = activeField.value?.name || '';
  }
};

const commitFieldOptions = async () => {
  if (isReadonly.value) return;
  const field = activeField.value;
  if (!field || !isSelectField(field)) return;
  if (isFieldOptionsLocked(field) || isFieldReadOnly(field)) return;
  if (optionsDraftFieldId.value !== field.id) return;
  const cleaned = optionsDraft.value
    .map((choice) => {
      const value = String(choice?.value ?? '').trim();
      if (!value) return null;
      const color = typeof choice?.color === 'string' && choice.color.trim() ? choice.color.trim() : null;
      return { value, color };
    })
    .filter(Boolean);
  const current = normalizeFieldOptions(field).choices.map((choice) => ({
    value: choice.value,
    color: choice.color || null,
  }));
  if (JSON.stringify(cleaned) === JSON.stringify(current)) return;
  const nextOptions = { ...normalizeFieldOptions(field), choices: cleaned };
  await updateField(field, { options: nextOptions });
  optionsDraft.value = cleaned;
};

const commitRelationOptions = async () => {
  if (isReadonly.value) return;
  const field = activeField.value;
  if (!field || !isRelationField(field)) return;
  if (isFieldOptionsLocked(field) || isFieldReadOnly(field)) return;
  if (relationDraftFieldId.value !== field.id) return;
  const targetId = relationDraftPageId.value.trim();
  if (!targetId) return;
  const allowed = relationTargetPages.value.some((page) => page.id === targetId);
  if (!allowed) return;
  const current = getRelationConfig(field);
  const baseOptions =
    field.options && typeof field.options === 'object' && !Array.isArray(field.options) ? { ...field.options } : {};
  const allowMultiple = relationDraftAllowMultiple.value === true;
  let historyPageId = relationDraftHistoryPageId.value;
  if (current?.pageId && current.pageId !== targetId) {
    historyPageId = '';
  }
  const history = relationDraftHistoryEnabled.value
    ? { enabled: true, ...(historyPageId ? { pageId: historyPageId } : {}) }
    : null;
  const nextOptions = {
    ...baseOptions,
    relation: {
      pageId: targetId,
      allowMultiple,
      ...(history ? { history } : {}),
    },
  };
  if (
    current?.pageId === targetId &&
    current?.allowMultiple === allowMultiple &&
    (current?.history?.enabled === history?.enabled || (!current?.history && !history)) &&
    ((current?.history?.pageId || '') === (history?.pageId || ''))
  ) {
    return;
  }
  await updateField(field, { options: nextOptions });
  relationDraftPageId.value = targetId;
  setRelationDraftForField(field);
  void loadRelationOptions(targetId);
};

const updateOptionValue = (index, value) => {
  const next = optionsDraft.value.map((choice, idx) => (idx === index ? { ...choice, value } : choice));
  optionsDraft.value = next;
};

const updateOptionColor = (index, color) => {
  const next = optionsDraft.value.map((choice, idx) => (idx === index ? { ...choice, color } : choice));
  optionsDraft.value = next;
};

const addOption = () => {
  optionsDraft.value = [...optionsDraft.value, { value: '', color: null }];
  nextTick(() => {
    const inputs = optionInputRefs.value;
    const last = inputs?.[inputs.length - 1];
    last?.focus?.();
  });
};

const removeOption = (index) => {
  optionsDraft.value = optionsDraft.value.filter((_, idx) => idx !== index);
};

const openOptionsPanel = () => {
  if (!activeField.value) return;
  if (!isSelectField(activeField.value)) return;
  if (isFieldOptionsLocked(activeField.value) || isFieldReadOnly(activeField.value)) return;
  setOptionsDraftForField(activeField.value);
  openPanel('options');
};

const closeOptionsPanel = async () => {
  await commitFieldOptions();
  openPanel('root');
};

const openRelationPanel = () => {
  if (!activeField.value) return;
  if (!isRelationField(activeField.value)) return;
  if (isFieldOptionsLocked(activeField.value) || isFieldReadOnly(activeField.value)) return;
  setRelationDraftForField(activeField.value);
  openPanel('relation');
};

const closeRelationPanel = async () => {
  await commitRelationOptions();
  openPanel('root');
};

// A column changed to "Linked from" follows the first relation elsewhere that points here (changed
// from its menu); without one there's nothing to show yet
const linkedFromOptionsForNewField = async () => {
  const relations = await loadIncomingRelations();
  const first = relations[0];
  if (!first) {
    window.alert('No other database links to this one yet. Add a relation column there that points here first.');
    return null;
  }
  return { linkedFrom: { pageId: first.databasePageId, fieldId: first.fieldId } };
};

const linkedFromKey = (relation) => (relation ? `${relation.pageId || relation.databasePageId}:${relation.fieldId}` : '');
const activeLinkedFromKey = computed(() => linkedFromKey(getLinkedFromConfig(activeField.value)));

const openLinkedFromPanel = () => {
  if (!activeField.value || !isLinkedFromField(activeField.value) || isReadonly.value) return;
  void loadIncomingRelations();
  openPanel('linkedFrom');
};

const chooseLinkedFrom = async (key) => {
  const relation = incomingRelations.value.find((entry) => linkedFromKey(entry) === key);
  if (!activeField.value || !relation) return;
  const options = { ...normalizeFieldOptions(activeField.value), linkedFrom: { pageId: relation.databasePageId, fieldId: relation.fieldId } };
  await updateField(activeField.value, { options });
};

const isMultiSelectOptionSelected = (value) => activeMultiSelectValues.value.includes(value);

// Opens the page of a row a relation links to, making the page first if that row has none yet
// (which only someone who can edit can do)
const openRelatedRow = async (field, rowId) => {
  const relation = getRelationConfig(field);
  if (!relation?.pageId || !rowId) return;
  const option = relationOptionsForPage(relation.pageId).find((entry) => entry.id === rowId);
  let pageId = option?.pageId || null;
  if (!pageId) {
    if (isReadonly.value || !hasApi.value || !activeUser.value) return;
    try {
      const res = await api.ensureDatabaseRowPage(
        rowId,
        { title: option?.label, pageId: relation.pageId },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      );
      const page = res?.page || null;
      pageId = page?.id || res?.row?.pageId || null;
      if (page) workspace.upsertPage(page);
      if (option && pageId) option.pageId = pageId;
    } catch (err) {
      console.warn('Opening the linked row failed', err);
      error.value = err?.message || 'Failed to open the linked row';
      return;
    }
  }
  if (!pageId) return;
  if (typeof openRowPageOverlay === 'function') openRowPageOverlay(pageId);
  else workspace.loadPageDoc(pageId);
};

const toggleMultiSelectOption = (value) => {
  if (isReadonly.value) return;
  const row = activeMultiSelectRow.value;
  const field = activeMultiSelectField.value;
  if (!row || !field || !value) return;
  // A single relation: choosing sets it (choosing it again clears it), and the picker closes
  if (field.type === 'RELATION' && !getRelationConfig(field)?.allowMultiple) {
    updateCell(row, field, activeMultiSelectValues.value.includes(value) ? '' : value);
    closeMultiSelectMenu();
    return;
  }
  const current = new Set(getMultiSelectValues(row, field));
  if (current.has(value)) {
    current.delete(value);
  } else {
    current.add(value);
  }
  let orderedValues = [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    const options = relation?.pageId ? relationOptionsForPage(relation.pageId) : [];
    orderedValues = options.map((option) => option.id);
  } else {
    const choices = getFieldChoices(field);
    orderedValues = choices.map((choice) => choice.value);
  }
  const ordered = orderedValues.filter((choiceValue) => current.has(choiceValue));
  const allowed = new Set(orderedValues);
  const extras = [...current].filter((choiceValue) => !allowed.has(choiceValue));
  const next = [...ordered, ...extras];
  updateCell(row, field, next);
};

const setFieldType = async (field, type) => {
  if (!field || !type) return;
  if (isFieldReadOnly(field) || isFieldTypeLocked(field)) return;
  let options = {};
  if (type === 'SELECT' || type === 'MULTI_SELECT') {
    const current = normalizeFieldOptions(field);
    options = { ...current, choices: current.choices };
  }
  if (type === 'RELATION') {
    const candidates = relationTargetPages.value;
    if (!candidates.length) {
      window.alert('Create another database to relate first.');
      return;
    }
    const targetId = candidates[0]?.id;
    if (!targetId) {
      window.alert('No relation target available.');
      return;
    }
    options = { relation: { pageId: targetId, allowMultiple: false } };
    void loadRelationOptions(targetId);
  }
  if (type === 'LINKED_FROM') {
    const linked = await linkedFromOptionsForNewField();
    if (!linked) return;
    options = { linkedFrom: linked.linkedFrom };
  }
  await updateField(field, { type, options });
  closeFieldMenu();
};

const sortField = (fieldId, direction) => {
  if (!fieldId) return;
  table.setSorting([{ id: fieldId, desc: direction === 'desc' }]);
  closeFieldMenu();
};

const clearSort = () => {
  table.setSorting([]);
  closeFieldMenu();
};

const { draggingFieldId, moveFieldBy, canMoveBy, dropSideFor, handleHeaderDragStart, handleHeaderDragOver, handleHeaderDrop, handleHeaderDragEnd } = useColumnReorder({
  fields,
  isHidden: (fieldId) => hiddenFieldIdSet.value.has(fieldId),
  isReadonly,
  isCollabEnabled,
  whenCollabSynced,
  ensureCollabDoc,
  collabFieldOrder,
  readCollabOrder,
  saveFieldPosition: (fieldId, position) =>
    runWithSavingIndicator(() => api.updateDatabaseField(fieldId, { position }, { userId: activeUser.value?.id, userName: activeUser.value?.name })),
});
const moveActiveField = (step) => {
  if (!activeField.value) return;
  void moveFieldBy(activeField.value.id, step);
  closeFieldMenu();
};

const deleteField = async (field) => {
  if (!field) return;
  if (isReadonly.value) return;
  if (isFieldReadOnly(field) || isFieldDeleteLocked(field)) return;
  if (fields.value.length <= 1) {
    window.alert('At least one column is required.');
    return;
  }
  const confirmed = window.confirm(`Delete column "${field.name || 'Untitled'}"? This will remove its data.`);
  if (!confirmed) return;
  if (isCollabEnabled.value) {
    whenCollabSynced(() => {
      const doc = ensureCollabDoc();
      const fieldsMap = collabFieldsMap.value || doc.getMap('fields');
      const fieldOrder = collabFieldOrder.value || doc.getArray('fieldOrder');
      const rowsMap = collabRowsMap.value || doc.getMap('rows');
      const order = readCollabOrder(fieldOrder);
      const index = order.findIndex((id) => id === field.id);
      doc.transact(() => {
        if (index >= 0) {
          fieldOrder.delete(index, 1);
        }
        fieldsMap.delete(field.id);
        rowsMap.forEach((entry) => {
          if (!(entry instanceof Y.Map)) return;
          const dataMap = ensureCollabRowDataMap(entry);
          dataMap?.delete(field.id);
        });
      }, 'db-field-delete');
    });
    sorting.value = sorting.value.filter((sort) => sort.id !== field.id);
    columnSizing.value = Object.fromEntries(Object.entries(columnSizing.value).filter(([key]) => key !== field.id));
    closeFieldMenu();
    return;
  }
  try {
    await runWithSavingIndicator(() => api.deleteDatabaseField(field.id, { userId: activeUser.value?.id, userName: activeUser.value?.name }));
    fields.value = fields.value.filter((item) => item.id !== field.id);
    rows.value = rows.value.map((row) => {
      const data = row?.data && typeof row.data === 'object' ? { ...row.data } : {};
      if (field.id in data) {
        delete data[field.id];
      }
      return { ...row, data };
    });
    sorting.value = sorting.value.filter((sort) => sort.id !== field.id);
    columnSizing.value = Object.fromEntries(
      Object.entries(columnSizing.value).filter(([key]) => key !== field.id)
    );
    closeFieldMenu();
  } catch (err) {
    console.warn('Delete field failed', err);
    error.value = err?.message || 'Failed to delete column';
  }
};

const loadDatabase = async () => {
  if (!props.pageId || !hasApi.value || !activeUser.value) return;
  loading.value = true;
  error.value = null;
  fields.value = [];
  rows.value = [];
  try {
    const res = await api.getDatabase(props.pageId, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    const nextFields = (res?.fields || []).map((field) => ({
      ...field,
      options: normalizeFieldOptions(field),
    }));
    const nextRows = (res?.rows || []).map(hydrateRow);
    syncComplianceStatusCache(nextRows);
    fields.value = nextFields;
    rows.value = nextRows;
    primeRelationOptions(nextFields);
    columnSizing.value = {
      [ROW_ID_COLUMN_ID]: ROW_ID_COLUMN_SIZE,
      ...getAutoColumnSizing(nextFields, nextRows),
    };
    const nextForms = Array.isArray(res?.forms)
      ? res.forms.map(normalizeFormView).filter(Boolean)
      : [];
    formViews.value = nextForms;
    const nextViews = Array.isArray(res?.views) ? res.views.map(normalizeSavedView).filter(Boolean) : [];
    savedViews.value = nextViews;
    // An embed can pin a specific saved view via the `viewId` prop.
    const pinnedViewId = props.viewId && nextViews.some((view) => view && view.id === props.viewId) ? props.viewId : '';
    const currentViewId = activeViewId.value;
    const keepFormView = nextForms.some((form) => form && form.id === currentViewId);
    const keepSavedView = nextViews.some((view) => view && view.id === currentViewId);
    const canShowForms = !props.embedded && (nextForms.length > 0 || canCreateForms.value);
    const keepFormsList = currentViewId === 'forms' && canShowForms;
    const keepAuditView = currentViewId === AUDIT_VIEW_ID && canShowAudit.value;
    activeViewId.value = pinnedViewId
      ? pinnedViewId
      : keepFormView || keepSavedView || keepFormsList || keepAuditView
        ? currentViewId
        : 'table';
    lastLoadedSnapshot.value = {
      fields: cloneForSeed(nextFields),
      rows: cloneForSeed(nextRows),
    };
    maybeSeedCollab();
    syncCollabFieldsFromSnapshot(lastLoadedSnapshot.value);
    syncCollabRowsFromSnapshot(lastLoadedSnapshot.value);
  } catch (err) {
    console.warn('Load database failed', err);
    error.value = err?.message || 'Failed to load database';
  } finally {
    loading.value = false;
  }
};

const loadMembers = async () => {
  if (!needsMembers.value) return;
  if (!membersWorkspaceId.value || !hasApi.value || !activeUser.value) return;
  if (membersLoadedFor.value === membersWorkspaceId.value) return;
  membersLoading.value = true;
  try {
    const res = await api.listWorkspaceMembers(membersWorkspaceId.value, { userId: activeUser.value.id });
    const list = Array.isArray(res)
      ? res.map((entry) => ({
          id: entry?.user?.id || entry?.userId || entry?.id,
          name: entry?.user?.displayName || entry?.user?.email || entry?.userId || 'Member',
        }))
      : [];
    workspaceMembers.value = list.filter((member) => member.id);
    membersLoadedFor.value = membersWorkspaceId.value;
  } catch (err) {
    console.warn('Load members failed', err);
  } finally {
    membersLoading.value = false;
  }
};

watch(
  () => props.pageId,
  () => {
    closeFieldMenu();
    closeAddFieldMenu();
    closeMultiSelectMenu();
    closeRowMenu();
    closeColumnsMenu();
    closeFormMenu();
    formViews.value = [];
    activeViewId.value = 'table';
    lastLoadedSnapshot.value = null;
    loadDatabase();
  },
  { immediate: true }
);

watch(
  () =>
    fields.value.map((field) => `${field.id}:${field.type}:${getRelationConfig(field)?.pageId || ''}`),
  () => {
    primeRelationOptions(fields.value);
  }
);

// When an embed changes its pinned saved view, switch to it (or back to the
// default all-rows table when cleared).
watch(
  () => props.viewId,
  (viewId) => {
    if (viewId && savedViews.value.some((view) => view.id === viewId)) {
      activeViewId.value = viewId;
    } else if (props.embedded) {
      activeViewId.value = 'table';
    }
  }
);

watch(
  () => [needsMembers.value, membersWorkspaceId.value, activeUser.value?.id],
  () => {
    if (!needsMembers.value) return;
    loadMembers();
  },
  { immediate: true }
);

watch(
  () => collabContext.value,
  () => {
    setupCollabProvider();
  },
  { immediate: true }
);

watch(
  () => [collabDoc.value, collabProvider.value],
  ([doc, provider]) => {
    emit('collabready', { doc, provider });
  },
  { immediate: true }
);

watch(
  () => [collabProvider.value, presenceUser.value],
  () => updateAwarenessUser(),
  { immediate: true }
);

watch(
  () => collabProvider.value,
  () => attachAwarenessListener(),
  { immediate: true }
);

const createFieldWithType = async (type, { linkedFrom: chosenLinkedFrom = null } = {}) => {
  if (isReadonly.value) return;
  if (!type) return;
  const trimmed = addFieldName.value.trim();
  let name = trimmed || addFieldPlaceholder.value;
  let options = {};
  if (type === 'SELECT' || type === 'MULTI_SELECT') {
    options = { choices: [] };
  }
  if (type === 'RELATION') {
    const candidates = relationTargetPages.value;
    if (!candidates.length) {
      window.alert('Create another database to relate first.');
      return;
    }
    const targetId = candidates[0]?.id;
    if (!targetId) {
      window.alert('No relation target available.');
      return;
    }
    options = { relation: { pageId: targetId, allowMultiple: false } };
    void loadRelationOptions(targetId);
  }
  if (type === 'LINKED_FROM') {
    let relation = chosenLinkedFrom;
    if (!relation) {
      const relations = await loadIncomingRelations();
      if (!relations.length) {
        window.alert('No other database links to this one yet. Add a relation column there that points here first.');
        return;
      }
      // More than one to follow: say which, in the menu
      if (relations.length > 1) {
        addFieldLinkedFromChoices.value = relations;
        return;
      }
      relation = relations[0];
    }
    options = { linkedFrom: { pageId: relation.databasePageId, fieldId: relation.fieldId } };
    // Named after the database it shows, unless given a name
    if (!trimmed) name = relation.databaseTitle || name;
  }
  if (isCollabEnabled.value) {
    whenCollabSynced(() => {
      const doc = ensureCollabDoc();
      const fieldsMap = collabFieldsMap.value || doc.getMap('fields');
      const fieldOrder = collabFieldOrder.value || doc.getArray('fieldOrder');
      const id = generateId();
      const fieldMap = new Y.Map();
      fieldMap.set('name', name);
      fieldMap.set('type', type);
      if (type === 'SELECT' || type === 'MULTI_SELECT') {
        fieldMap.set('options', normalizeFieldOptions({ options }));
      } else if (type === 'RELATION' || type === 'LINKED_FROM') {
        fieldMap.set('options', { ...options });
      } else {
        fieldMap.set('options', {});
      }
      doc.transact(() => {
        fieldsMap.set(id, fieldMap);
        fieldOrder.push([id]);
      }, 'db-field-add');
    });
    closeAddFieldMenu();
    return;
  }
  try {
    const field = await runWithSavingIndicator(() =>
      api.createDatabaseField(
        props.pageId,
        { name, type, options },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    fields.value = [...fields.value, { ...field, options: normalizeFieldOptions(field) }];
    closeAddFieldMenu();
  } catch (err) {
    console.warn('Create field failed', err);
    error.value = err?.message || 'Failed to create field';
  }
};

const updateField = async (field, changes) => {
  if (isReadonly.value) return;
  if (isFieldReadOnly(field) && ('name' in changes || 'type' in changes || 'options' in changes)) {
    return;
  }
  const nextChanges = { ...changes };
  if (isFieldTypeLocked(field) && 'type' in nextChanges) {
    delete nextChanges.type;
  }
  if (isFieldOptionsLocked(field) && 'options' in nextChanges) {
    delete nextChanges.options;
  }
  if (!Object.keys(nextChanges).length) return;
  const nextType = nextChanges.type || field?.type;
  const shouldCleanupMultiSelect = 'options' in nextChanges && nextType === 'MULTI_SELECT' && !isMembersField(field);
  if (isCollabEnabled.value) {
    if (!field?.id) return;
    let nextOptions = null;
    if ('options' in nextChanges) {
      const rawOptions =
        nextChanges.options && typeof nextChanges.options === 'object' && !Array.isArray(nextChanges.options)
          ? nextChanges.options
          : {};
      const shouldNormalize = nextType === 'SELECT' || nextType === 'MULTI_SELECT';
      nextOptions = shouldNormalize ? normalizeFieldOptions({ options: rawOptions }) : rawOptions;
    }
    whenCollabSynced(() => {
      const fieldMap = ensureCollabFieldMap(field.id);
      if (!fieldMap) return;
      ensureCollabDoc().transact(() => {
        if ('name' in nextChanges) {
          fieldMap.set('name', nextChanges.name ?? '');
        }
        if ('type' in nextChanges && nextChanges.type) {
          fieldMap.set('type', nextChanges.type);
        }
        if ('options' in nextChanges) {
          fieldMap.set('options', nextOptions || {});
        }
      }, 'db-field-update');
    });
    const updatedField = {
      ...field,
      ...nextChanges,
      options:
        'options' in nextChanges
          ? normalizeFieldOptions({ options: nextChanges.options || {} })
          : normalizeFieldOptions(field),
    };
    emitFieldUpdated(updatedField);
    if (shouldCleanupMultiSelect) {
      cleanupMultiSelectOptions({ ...field, type: nextType }, nextOptions || {});
    }
    return;
  }
  try {
    const updated = await runWithSavingIndicator(() =>
      api.updateDatabaseField(field.id, nextChanges, { userId: activeUser.value?.id, userName: activeUser.value?.name })
    );
    Object.assign(field, updated, { options: normalizeFieldOptions(updated) });
    emitFieldUpdated(field);
    if (shouldCleanupMultiSelect) {
      cleanupMultiSelectOptions({ ...field, type: nextType }, updated?.options || nextChanges.options || {});
    }
  } catch (err) {
    console.warn('Update field failed', err);
    error.value = err?.message || 'Failed to update field';
  }
};

const deleteRow = async (row) => {
  if (isReadonly.value) return;
  const rowId = row?.id;
  if (!rowId) return;
  const confirmed = window.confirm('Delete this row?');
  if (!confirmed) return;
  closeRowMenu();
  if (selectedRowIds.value.has(rowId)) {
    const next = new Set(selectedRowIds.value);
    next.delete(rowId);
    selectedRowIds.value = next;
  }
  if (isCollabEnabled.value) {
    whenCollabSynced(() => {
      const doc = ensureCollabDoc();
      const rowsMap = collabRowsMap.value || doc.getMap('rows');
      const rowOrder = collabRowOrder.value || doc.getArray('rowOrder');
      collabRowsMap.value = rowsMap;
      collabRowOrder.value = rowOrder;
      const order = readCollabOrder(rowOrder);
      const index = order.findIndex((id) => id === rowId);
      doc.transact(() => {
        if (index >= 0) {
          rowOrder.delete(index, 1);
        }
        rowsMap.delete(rowId);
      }, 'db-row-delete');
    });
    rows.value = rows.value.filter((item) => item.id !== rowId);
  }
  if (!hasApi.value || !activeUser.value) return;
  try {
    await runWithSavingIndicator(() => api.deleteDatabaseRow(rowId, { userId: activeUser.value.id, userName: activeUser.value.name }));
    if (!isCollabEnabled.value) {
      rows.value = rows.value.filter((item) => item.id !== rowId);
    }
  } catch (err) {
    console.warn('Delete row failed', err);
    error.value = err?.message || 'Failed to delete row';
  }
};

const toggleRowSelection = (rowId) => {
  const next = new Set(selectedRowIds.value);
  if (next.has(rowId)) {
    next.delete(rowId);
  } else {
    next.add(rowId);
  }
  selectedRowIds.value = next;
};

const toggleSelectAll = () => {
  if (selectedRowIds.value.size === rows.value.length) {
    selectedRowIds.value = new Set();
  } else {
    selectedRowIds.value = new Set(rows.value.map((r) => r.id));
  }
};

const clearSelection = () => {
  selectedRowIds.value = new Set();
};

const deleteSelectedRows = async () => {
  if (isReadonly.value) return;
  const ids = [...selectedRowIds.value];
  if (!ids.length) return;
  const confirmed = window.confirm(`Delete ${ids.length} row${ids.length > 1 ? 's' : ''}?`);
  if (!confirmed) return;
  const idSet = new Set(ids);
  if (isCollabEnabled.value) {
    whenCollabSynced(() => {
      const doc = ensureCollabDoc();
      const rowsMap = collabRowsMap.value || doc.getMap('rows');
      const rowOrder = collabRowOrder.value || doc.getArray('rowOrder');
      collabRowsMap.value = rowsMap;
      collabRowOrder.value = rowOrder;
      doc.transact(() => {
        const order = readCollabOrder(rowOrder);
        // Delete from order in reverse to keep indices valid
        for (let i = order.length - 1; i >= 0; i--) {
          if (idSet.has(order[i])) {
            rowOrder.delete(i, 1);
          }
        }
        for (const id of ids) {
          rowsMap.delete(id);
        }
      }, 'db-row-delete');
    });
    rows.value = rows.value.filter((item) => !idSet.has(item.id));
    selectedRowIds.value = new Set();
  }
  if (!hasApi.value || !activeUser.value) return;
  try {
    await runWithSavingIndicator(() =>
      Promise.all(
        ids.map((id) =>
          api.deleteDatabaseRow(id, { userId: activeUser.value.id, userName: activeUser.value.name })
        )
      )
    );
    if (!isCollabEnabled.value) {
      rows.value = rows.value.filter((item) => !idSet.has(item.id));
    }
    selectedRowIds.value = new Set();
  } catch (err) {
    console.warn('Bulk delete rows failed', err);
    error.value = err?.message || 'Failed to delete rows';
  }
};

const addRow = async () => {
  if (isReadonly.value) return;
  if (isWikiDatabase.value) {
    const homeId = wikiHomeId.value;
    const homePage = homeId ? pageMap.value.get(homeId) : null;
    if (!homePage) return;
    await workspace.createChildPageRecord(homePage);
    await loadDatabase();
    return;
  }
  if (isCollabEnabled.value && isComplianceDatabase.value) {
    if (!hasApi.value || !activeUser.value) return;
    try {
      const row = await runWithSavingIndicator(() =>
        api.createDatabaseRow(
          props.pageId,
          { data: {} },
          { userId: activeUser.value.id, userName: activeUser.value.name }
        )
      );
      const hydrated = hydrateRow(row);
      syncComplianceStatusCache([hydrated]);
      const existingIndex = rows.value.findIndex((item) => item.id === hydrated.id);
      if (existingIndex >= 0) {
        rows.value = rows.value.map((item, index) => (index === existingIndex ? { ...item, ...hydrated } : item));
      } else {
        rows.value = [...rows.value, hydrated];
      }
      whenCollabSynced(() => {
        const doc = ensureCollabDoc();
        const rowMap = ensureCollabRowMap(hydrated.id);
        const dataMap = ensureCollabRowDataMap(rowMap);
        const rowOrder = collabRowOrder.value || doc.getArray('rowOrder');
        collabRowOrder.value = rowOrder;
        const data = hydrated?.data && typeof hydrated.data === 'object' ? hydrated.data : {};
        doc.transact(() => {
          if (dataMap) {
            clearYMap(dataMap);
            Object.entries(data).forEach(([key, value]) => {
              dataMap.set(key, value);
            });
          }
          if (hydrated.pageId) {
            rowMap?.set('pageId', hydrated.pageId);
          }
          const order = readCollabOrder(rowOrder);
          if (!order.includes(hydrated.id)) {
            rowOrder.push([hydrated.id]);
          }
        }, 'db-row-add');
      });
    } catch (err) {
      console.warn('Create row failed', err);
      error.value = err?.message || 'Failed to create row';
    }
    return;
  }
  if (isCollabEnabled.value) {
    whenCollabSynced(() => {
      const doc = ensureCollabDoc();
      const rowsMap = collabRowsMap.value || doc.getMap('rows');
      const rowOrder = collabRowOrder.value || doc.getArray('rowOrder');
      const id = generateId();
      const rowMap = new Y.Map();
      rowMap.set('data', new Y.Map());
      doc.transact(() => {
        rowsMap.set(id, rowMap);
        rowOrder.push([id]);
      }, 'db-row-add');
    });
    return;
  }
  try {
    const row = await runWithSavingIndicator(() =>
      api.createDatabaseRow(
        props.pageId,
        { data: {} },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    const hydrated = hydrateRow(row);
    syncComplianceStatusCache([hydrated]);
    rows.value = [...rows.value, hydrated];
  } catch (err) {
    console.warn('Create row failed', err);
    error.value = err?.message || 'Failed to create row';
  }
};

// What the form builder needs from the table (FormBuilder.vue).

const formBuilderContext = {
  embedded: toRef(props, 'embedded'),
  canCreateForms,
  deleteFormView,
  isComplianceDatabase,
  isReadonly,
  openFormPage,
  activeUser,
  activeViewId,
  auditStatusIds,
  error,
  fieldById,
  fields,
  formViews,
  hasApi,
  loadRelationOptions,
  normalizeFormAuto,
  normalizeFormConfig,
  normalizeFormSelectSource,
  normalizeFormView,
  relationFieldsByPageId,
  relationOptionsErrorForPage,
  relationOptionsForPage,
  relationOptionsLoading,
  relationOptionsLoadingForPage,
  relationRowsByPageId,
  runWithSavingIndicator,
};

// The gallery's "Card fields" and the list's "Properties" menus close on a click elsewhere
const closeCardFieldMenus = (event) => {
  databaseRootRef.value?.querySelectorAll('.db-card-fields[open]').forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute('open');
  });
};

onMounted(() => {
  document.addEventListener('mousedown', closeCardFieldMenus);
  document.addEventListener('mousedown', handleFieldMenuOutside);
  document.addEventListener('mousedown', handleRowMenuOutside);
  document.addEventListener('mousedown', handleViewMenuOutside);
  window.addEventListener('keydown', handleViewMenuKeydown);
  window.addEventListener('keydown', handleFieldMenuKeydown);
  window.addEventListener('keydown', handleRowMenuKeydown);
  updateTableWrapWidth();
  if (typeof ResizeObserver !== 'undefined') {
    tableWrapObserver = new ResizeObserver(() => updateTableWrapWidth());
    if (tableWrapRef.value) {
      tableWrapObserver.observe(tableWrapRef.value);
    }
    if (databaseRootRef.value && databaseRootRef.value !== tableWrapRef.value) {
      tableWrapObserver.observe(databaseRootRef.value);
    }
  } else if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateTableWrapWidth);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('wikid:page-title-updated', handlePageTitleUpdated);
    window.addEventListener('wikid:db-row-updated', handleRowPropertiesUpdated);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeCardFieldMenus);
  document.removeEventListener('mousedown', handleFieldMenuOutside);
  document.removeEventListener('mousedown', handleRowMenuOutside);
  document.removeEventListener('mousedown', handleViewMenuOutside);
  window.removeEventListener('keydown', handleViewMenuKeydown);
  window.removeEventListener('keydown', handleFieldMenuKeydown);
  window.removeEventListener('keydown', handleRowMenuKeydown);
  if (tableWrapObserver) {
    tableWrapObserver.disconnect();
    tableWrapObserver = null;
  }
  window.removeEventListener('resize', updateTableWrapWidth);
  if (typeof window !== 'undefined') {
    window.removeEventListener('wikid:page-title-updated', handlePageTitleUpdated);
    window.removeEventListener('wikid:db-row-updated', handleRowPropertiesUpdated);
  }
  teardownCollabProvider();
  clearLocalCellCursor();
  rowSaveTimers.forEach(({ timer, started }) => {
    clearTimeout(timer);
    if (started) {
      workspace.finishSaving(started);
    }
  });
  rowSaveTimers.clear();
  flushPageTitleUpdates();
});
</script>

<template>
  <div ref="databaseRootRef" :class="['database-table', { 'database-table--embedded': embedded }]">
    <div v-if="showConnectionNotice && !props.readonly" class="database-table__connection" role="status" aria-live="polite">
      <strong>{{ collabEverSynced ? 'Reconnecting…' : 'Connecting…' }}</strong>
      {{ collabEverSynced ? 'Editing is paused until the table reconnects.' : 'You can edit the table once it has connected.' }}
    </div>
    <teleport v-if="toolbarTeleportTarget" :to="toolbarTeleportTarget">
      <div class="database-table__toolbar">
        <span v-if="error" class="alert database-table__alert">{{ error }}</span>
        <div v-if="showFormTabs" class="database-table__views database-table__views--toolbar">
          <button
            class="db-view-tab"
            :class="{ 'db-view-tab--active': isTableView }"
            type="button"
            :aria-current="isTableView ? 'page' : null"
            @click="activeViewId = 'table'"
          >
            Table
          </button>
          <template v-for="view in savedViews" :key="view.id">
            <button
              class="db-view-tab"
              :class="{ 'db-view-tab--active': activeViewId === view.id }"
              type="button"
              :title="view.name"
              :aria-current="activeViewId === view.id ? 'page' : null"
              @click="activeViewId = view.id"
              @dblclick="renameSavedView(view)"
              @contextmenu.prevent="openViewMenu(view, $event)"
            >
              <PageIcon class="db-view-tab__icon" :icon="view.icon" fallback="Vw" aria-hidden="true" />
              <span class="db-view-tab__label">{{ view.name }}</span>
            </button>
            <button
              v-if="activeViewId === view.id && canCreateForms"
              class="db-view-tab__more"
              type="button"
              :aria-label="`${view.name} view options`"
              title="View options"
              @click.stop="openViewMenu(view, $event)"
            >
              <i class="bi bi-three-dots" aria-hidden="true"></i>
            </button>
          </template>
          <button
            v-if="canShowAudit"
            class="db-view-tab"
            :class="{ 'db-view-tab--active': isAuditView }"
            type="button"
            :aria-current="isAuditView ? 'page' : null"
            @click="activeViewId = AUDIT_VIEW_ID"
          >
            Audit
          </button>
          <button
            class="db-view-tab"
            :class="{ 'db-view-tab--active': isFormsView }"
            type="button"
            :aria-current="isFormsView ? 'page' : null"
            @click="activeViewId = 'forms'"
          >
            Forms
            <span v-if="formViews.length" class="db-view-tab__count">{{ formViews.length }}</span>
          </button>
        </div>
        <div class="database-table__search">
          <button
            v-if="activeSavedView && !embedded"
            class="db-filter-menu-button"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="filterMenu.open"
            @click.stop="openFilterMenu"
          >
            <i class="bi bi-funnel" aria-hidden="true"></i>
            Filter<span v-if="activeFilterCount" class="db-view-tab__count">{{ activeFilterCount }}</span>
          </button>
          <button
            v-if="activeSavedView && !embedded"
            class="db-sort-menu-button"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="sortMenu.open"
            @click.stop="openSortMenu"
          >
            <i class="bi bi-sort-down" aria-hidden="true"></i>
            Sort<span v-if="activeViewSorts.length" class="db-view-tab__count">{{ activeViewSorts.length }}</span>
          </button>
          <button
            v-if="canConfigureView"
            class="db-columns-button"
            type="button"
            aria-haspopup="menu"
            :aria-expanded="columnsMenu.open"
            @click.stop="openColumnsMenu"
          >
            Columns
          </button>
          <input
            v-if="showFilterInput"
            ref="filterInputRef"
            class="db-filter-input"
            type="search"
            placeholder="Filter rows"
            :value="globalFilter"
            @input="updateGlobalFilter"
            @blur="closeFilter"
            @keydown="handleFilterKeydown"
          />
          <button
            v-else
            class="db-filter-button"
            type="button"
            aria-label="Filter rows"
            @click="openFilter"
          >
            <i class="bi bi-search" aria-hidden="true"></i>
          </button>
          <button v-if="showFilterInput && globalFilter" class="db-filter-clear" type="button" @click="clearGlobalFilter">
            ×
          </button>
          <button
            v-if="canCreateForms"
            class="db-form-button"
            type="button"
            aria-label="Create form view"
            aria-haspopup="menu"
            :aria-expanded="formMenu.open"
            @click.stop="openFormMenu"
          >
            +
          </button>
        </div>
      </div>
    </teleport>
    <div v-else class="database-table__toolbar">
      <span v-if="error" class="alert database-table__alert">{{ error }}</span>
      <div v-if="showFormTabs" class="database-table__views database-table__views--toolbar">
        <button
          class="db-view-tab"
          :class="{ 'db-view-tab--active': isTableView }"
          type="button"
          :aria-current="isTableView ? 'page' : null"
          @click="activeViewId = 'table'"
        >
          Table
        </button>
        <template v-for="view in savedViews" :key="view.id">
          <button
            class="db-view-tab"
            :class="{ 'db-view-tab--active': activeViewId === view.id }"
            type="button"
            :title="view.name"
            :aria-current="activeViewId === view.id ? 'page' : null"
            @click="activeViewId = view.id"
            @dblclick="renameSavedView(view)"
            @contextmenu.prevent="openViewMenu(view, $event)"
          >
            <PageIcon class="db-view-tab__icon" :icon="view.icon" fallback="Vw" aria-hidden="true" />
            <span class="db-view-tab__label">{{ view.name }}</span>
          </button>
          <button
            v-if="activeViewId === view.id && canCreateForms"
            class="db-view-tab__more"
            type="button"
            :aria-label="`${view.name} view options`"
            title="View options"
            @click.stop="openViewMenu(view, $event)"
          >
            <i class="bi bi-three-dots" aria-hidden="true"></i>
          </button>
        </template>
        <button
          v-if="canShowAudit"
          class="db-view-tab"
          :class="{ 'db-view-tab--active': isAuditView }"
          type="button"
          :aria-current="isAuditView ? 'page' : null"
          @click="activeViewId = AUDIT_VIEW_ID"
        >
          Audit
        </button>
        <button
          class="db-view-tab"
          :class="{ 'db-view-tab--active': isFormsView }"
          type="button"
          :aria-current="isFormsView ? 'page' : null"
          @click="activeViewId = 'forms'"
        >
          Forms
          <span v-if="formViews.length" class="db-view-tab__count">{{ formViews.length }}</span>
        </button>
      </div>
      <div class="database-table__search">
        <button
          v-if="activeSavedView && !embedded"
          class="db-filter-menu-button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="filterMenu.open"
          @click.stop="openFilterMenu"
        >
          <i class="bi bi-funnel" aria-hidden="true"></i>
          Filter<span v-if="activeFilterCount" class="db-view-tab__count">{{ activeFilterCount }}</span>
        </button>
        <button
          v-if="activeSavedView && !embedded"
          class="db-sort-menu-button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="sortMenu.open"
          @click.stop="openSortMenu"
        >
          <i class="bi bi-sort-down" aria-hidden="true"></i>
          Sort<span v-if="activeViewSorts.length" class="db-view-tab__count">{{ activeViewSorts.length }}</span>
        </button>
        <button
          v-if="canConfigureView"
          class="db-columns-button"
          type="button"
          aria-haspopup="menu"
          :aria-expanded="columnsMenu.open"
          @click.stop="openColumnsMenu"
        >
          Columns
        </button>
        <input
          v-if="showFilterInput"
          ref="filterInputRef"
          class="db-filter-input"
          type="search"
          placeholder="Filter rows"
          :value="globalFilter"
          @input="updateGlobalFilter"
          @blur="closeFilter"
          @keydown="handleFilterKeydown"
        />
        <button
          v-else
          class="db-filter-button"
          type="button"
          aria-label="Filter rows"
          @click="openFilter"
        >
          <i class="bi bi-search" aria-hidden="true"></i>
        </button>
        <button v-if="showFilterInput && globalFilter" class="db-filter-clear" type="button" @click="clearGlobalFilter">
          ×
        </button>
        <button
          v-if="canCreateForms"
          class="db-form-button"
          type="button"
          aria-label="Create form view"
          aria-haspopup="menu"
          :aria-expanded="formMenu.open"
          @click.stop="openFormMenu"
        >
          +
        </button>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading database...</div>
    <div v-else class="database-table__panel">
      <div ref="tableWrapRef" class="database-table__wrap" @focusout="onTableFocusOut">
        <template v-if="showTableView">
          <div v-if="isAuditView" class="db-audit-key" :style="{ minWidth: `${table.getTotalSize()}px` }">
            <div class="db-audit-key__title">Governance status</div>
            <div class="db-audit-key__items">
              <div v-for="status in auditStatusOptions" :key="status.id" class="db-audit-key__item">
                <span
                  :class="['db-audit-key__swatch', `db-audit-key__swatch--${status.tone}`]"
                  aria-hidden="true"
                ></span>
                <span>{{ status.label }}</span>
              </div>
            </div>
          </div>
          <div v-if="selectedRowIds.size" class="db-bulk-bar">
            <span class="db-bulk-bar__count">{{ selectedRowIds.size }} row{{ selectedRowIds.size > 1 ? 's' : '' }} selected</span>
            <button class="db-bulk-bar__action db-bulk-bar__action--delete" type="button" @click="deleteSelectedRows">Delete</button>
            <button class="db-bulk-bar__action" type="button" @click="clearSelection">Cancel</button>
          </div>
          <table class="database-table__table" :style="{ width: `${table.getTotalSize()}px` }">
          <thead>
            <tr v-for="headerGroup in table.getHeaderGroups()" :key="headerGroup.id">
              <th
                v-for="(header, headerIndex) in headerGroup.headers"
                :key="header.id"
                :class="{
                  'db-header--sorted': !!header.column.getIsSorted(),
                  'db-header--add': header.column.id === ADD_COLUMN_ID,
                  'db-header--dragging': draggingFieldId === header.column.id,
                  [`db-header--drop-${dropSideFor(header.column.id)}`]: !!dropSideFor(header.column.id),
                }"
                :aria-sort="
                  header.column.getIsSorted() === 'asc'
                    ? 'ascending'
                    : header.column.getIsSorted() === 'desc'
                      ? 'descending'
                      : 'none'
                "
                :style="{ width: `${header.getSize()}px` }"
                @dragover="header.column.id !== ADD_COLUMN_ID && handleHeaderDragOver(header.column.id, $event)"
                @drop="handleHeaderDrop"
              >
                <div class="db-header-cell" :class="{ 'db-header-cell--add': header.column.id === ADD_COLUMN_ID }">
                  <input
                    v-if="headerIndex === 0 && selectedRowIds.size && !isReadonly"
                    type="checkbox"
                    class="db-row-checkbox db-select-all-checkbox"
                    :checked="selectedRowIds.size === rows.length"
                    :ref="(el) => { if (el) el.indeterminate = selectedRowIds.size > 0 && selectedRowIds.size < rows.length }"
                    @click.stop="toggleSelectAll"
                  />
                  <template v-if="!header.isPlaceholder && header.column.id === ADD_COLUMN_ID">
                    <button
                      class="db-add-column-btn"
                      type="button"
                      :disabled="isReadonly"
                      @click.stop="openAddFieldMenu"
                    >
                      {{ ADD_COLUMN_LABEL }}
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-if="!header.isPlaceholder"
                      class="db-header-button"
                      :class="{ 'db-header-button--sorted': !!header.column.getIsSorted() }"
                      type="button"
                      :disabled="isReadonly"
                      :draggable="!isReadonly"
                      @dragstart="handleHeaderDragStart(header.column.id, $event)"
                      @dragend="handleHeaderDragEnd"
                      @click.stop="openFieldMenu(header.column.id, $event)"
                      @contextmenu.prevent.stop="openFieldMenu(header.column.id, $event)"
                    >
                      <span class="db-header-label">
                        <FlexRender :render="header.column.columnDef.header" :props="header.getContext()" />
                      </span>
                      <span v-if="header.column.getIsSorted() === 'asc'" class="db-header-sort">^</span>
                      <span v-else-if="header.column.getIsSorted() === 'desc'" class="db-header-sort">v</span>
                    </button>
                    <div
                      v-if="header.column.getCanResize?.()"
                      class="db-resizer"
                      :class="{ active: header.column.getIsResizing?.() }"
                      @mousedown.stop.prevent="header.getResizeHandler()($event)"
                      @touchstart.stop.prevent="header.getResizeHandler()($event)"
                    ></div>
                  </template>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in table.getRowModel().rows"
              :key="row.id"
              :class="['db-row', getAuditRowClass(row.original), { 'db-row--menu-open': rowMenu.open && rowMenu.rowId === row.id, 'db-row--selected': selectedRowIds.size && selectedRowIds.has(row.original.id) }]"
            >
              <td
                v-for="(cell, cellIndex) in row.getVisibleCells()"
                :key="cell.id"
                :style="{ width: `${cell.column.getSize()}px` }"
              >
                <div :class="['db-row-cell', { 'db-row-cell--first': cellIndex === 0 }]">
                  <template v-if="cellIndex === 0 && !readonly">
                    <input
                      v-if="selectedRowIds.size"
                      type="checkbox"
                      class="db-row-checkbox"
                      :checked="selectedRowIds.has(row.original.id)"
                      @click.stop="toggleRowSelection(row.original.id)"
                    />
                    <template v-else>
                      <input
                        type="checkbox"
                        class="db-row-checkbox db-row-checkbox--hover"
                        :checked="false"
                        @click.stop="toggleRowSelection(row.original.id)"
                      />
                      <button
                        class="db-row-handle"
                        type="button"
                        aria-label="Row actions"
                        aria-haspopup="menu"
                        @click.stop="openRowMenu(row.original, $event)"
                      >
                        ⋮
                      </button>
                    </template>
                  </template>
                  <button
                    v-else-if="cellIndex === 0 && readonly"
                    class="db-row-handle"
                    type="button"
                    disabled
                    aria-label="Row actions"
                  >
                    ⋮
                  </button>
                  <FlexRender :render="cell.column.columnDef.cell" :props="cell.getContext()" />
                </div>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="db-add-row-cell" :colspan="visibleColumnCount">
                <button class="db-add-row-btn" type="button" :disabled="isReadonly" @click="addRow">
                  {{ isWikiDatabase ? 'Add page' : 'Add row' }}
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
          <div v-if="!rows.length" class="database-table__empty muted">No rows yet.</div>
        </template>
        <div v-else-if="isGalleryView" class="db-gallery">
          <div v-if="!embedded" class="db-view-config-bar">
            <label class="db-view-config-bar__label">Cover</label>
            <select
              class="db-view-config__select"
              :value="activeSavedView?.config?.cardFieldId || ''"
              @change="setGalleryCardField($event.target.value)"
            >
              <option value="">None</option>
              <option v-for="field in fields" :key="field.id" :value="field.id">{{ field.name || 'Field' }}</option>
            </select>
            <template v-if="isListCover">
              <label class="db-view-config-bar__label" for="db-gallery-cover-max">Show</label>
              <input
                id="db-gallery-cover-max"
                class="db-view-config__number"
                type="number"
                min="1"
                max="50"
                :value="coverMax"
                aria-label="Linked rows shown on a card before Show more"
                @input="handleCoverMaxInput"
                @change="handleCoverMaxChange"
              />
            </template>
            <details class="db-card-fields">
              <summary class="db-card-fields__toggle">Card fields</summary>
              <div class="db-card-fields__menu">
                <label v-for="field in cardFieldCandidates" :key="field.id" class="db-card-fields__option">
                  <input type="checkbox" :checked="cardFieldShown(field.id)" @change="toggleCardField(field.id)" />
                  {{ field.name || 'Field' }}
                </label>
                <div v-if="!cardFieldCandidates.length" class="db-card-fields__empty">No other columns</div>
              </div>
            </details>
          </div>
          <div v-if="!viewFilteredRows.length" class="database-table__empty muted">No matching rows.</div>
          <div v-else class="db-gallery__grid">
            <div
              v-for="row in viewFilteredRows"
              :key="row.id"
              role="button"
              tabindex="0"
              class="db-gallery__card"
              @click="openRowCard(row)"
              @keydown.enter.self.prevent="openRowCard(row)"
              @keydown.space.self.prevent="openRowCard(row)"
            >
              <div class="db-gallery__title">{{ rowTitle(row) }}</div>
              <div v-if="galleryCardField && isListCover" class="db-gallery__cover db-gallery__cover--list">
                <span class="db-gallery__cover-label">{{ galleryCardField.name || 'Field' }}</span>
                <template v-for="item in shownCoverItems(row)" :key="item.key">
                  <button v-if="item.open" class="db-gallery__cover-item" type="button" :title="`Open ${item.label}`" @click.stop="item.open()">
                    {{ item.label }}
                  </button>
                  <span v-else class="db-gallery__cover-item db-gallery__cover-item--plain">{{ item.label }}</span>
                </template>
                <button
                  v-if="moreCoverItems(row)"
                  class="db-gallery__cover-item db-gallery__cover-more"
                  type="button"
                  @click.stop="toggleCoverExpanded(row.id)"
                >
                  {{ expandedCovers.has(row.id) ? 'Show less' : `Show ${moreCoverItems(row)} more` }}
                </button>
                <span v-if="!coverItems(row).length" class="db-gallery__cover-empty">—</span>
              </div>
              <div
                v-else-if="galleryCardField"
                class="db-gallery__cover"
              >{{ galleryCardValue(row, galleryCardField) }}</div>
              <div class="db-gallery__fields">
                <div v-for="field in cardBodyFields" :key="field.id" class="db-gallery__field">
                  <span class="db-gallery__field-name">{{ field.name }}</span>
                  <span class="db-gallery__field-value">{{ galleryCardValue(row, field) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="isListView" class="db-list">
          <div v-if="!embedded" class="db-view-config-bar">
            <details class="db-card-fields">
              <summary class="db-card-fields__toggle">Properties</summary>
              <div class="db-card-fields__menu">
                <label v-for="field in cardFieldCandidates" :key="field.id" class="db-card-fields__option">
                  <input type="checkbox" :checked="listFieldShown(field.id)" @change="toggleListField(field.id)" />
                  {{ field.name || 'Field' }}
                </label>
                <div v-if="!cardFieldCandidates.length" class="db-card-fields__empty">No other columns</div>
              </div>
            </details>
          </div>
          <div v-if="!viewFilteredRows.length" class="database-table__empty muted">No matching rows.</div>
          <ul v-else class="db-list__rows">
            <li v-for="row in viewFilteredRows" :key="row.id" class="db-list__row">
              <button class="db-list__title" type="button" @click="openRowCard(row)">
                <PageIcon class="db-list__icon" :icon="rowIcon(row)" fallback="📄" aria-hidden="true" />
                <span class="db-list__name">{{ rowTitle(row) }}</span>
              </button>
              <span v-if="listFields.length" class="db-list__properties">
                <span v-for="field in listFields" :key="field.id" class="db-list__property" :title="field.name">
                  <template v-if="isLinkField(field)">
                    <template v-for="item in linkItemsFor(row, field)" :key="item.key">
                      <button v-if="item.open" class="db-multi-pill db-relation-pill" type="button" :title="`Open ${item.label}`" @click="item.open()">{{ item.label }}</button>
                      <span v-else class="db-multi-pill">{{ item.label }}</span>
                    </template>
                  </template>
                  <template v-else>{{ galleryCardValue(row, field) }}</template>
                </span>
              </span>
            </li>
          </ul>
        </div>
        <div v-else-if="isBoardView" class="db-board">
          <div v-if="!embedded" class="db-view-config-bar">
            <label class="db-view-config-bar__label">Group by</label>
            <select
              class="db-view-config__select"
              :value="activeSavedView?.config?.groupFieldId || ''"
              @change="setBoardGroupField($event.target.value)"
            >
              <option value="">None</option>
              <option
                v-for="field in fields.filter((f) => f.type === 'SELECT')"
                :key="field.id"
                :value="field.id"
              >
                {{ field.name || 'Field' }}
              </option>
            </select>
          </div>
          <div class="db-board__columns">
            <div v-for="column in boardColumns" :key="column.key" class="db-board__column">
              <div class="db-board__column-header">
                <span class="db-board__column-title">{{ column.label }}</span>
                <span class="db-view-tab__count">{{ column.rows.length }}</span>
              </div>
              <div class="db-board__cards">
                <button
                  v-for="row in column.rows"
                  :key="row.id"
                  type="button"
                  class="db-board__card"
                  @click="openRowCard(row)"
                >
                  <div class="db-board__card-title">{{ rowTitle(row) }}</div>
                  <div v-for="field in cardBodyFields" :key="field.id" class="db-board__card-field">
                    <span class="db-gallery__field-name">{{ field.name }}</span>
                    <span class="db-gallery__field-value">{{ galleryCardValue(row, field) }}</span>
                  </div>
                </button>
                <div v-if="!column.rows.length" class="db-board__empty muted">—</div>
              </div>
            </div>
          </div>
        </div>
        <div v-else-if="isFormsView" class="db-forms-list">
        <div class="db-forms-list__header">
          <div class="db-forms-list__heading">
            <div class="db-forms-list__title">Forms</div>
            <div class="db-forms-list__meta">{{ formViews.length }} forms</div>
          </div>
          <button
            v-if="canCreateForms"
            class="db-form-open-btn"
            type="button"
            @click="createFormView"
          >
            New form
          </button>
        </div>
        <div v-if="!formViews.length" class="db-form-empty muted">
          No forms yet. Use the plus button to add one.
        </div>
        <div v-else class="db-forms-list__grid">
          <div v-for="form in formViews" :key="form.id" class="db-forms-list__item">
            <div class="db-forms-list__info">
              <div class="db-forms-list__row">
                <PageIcon
                  class="db-forms-list__icon"
                  :icon="form.icon || DEFAULT_FORM_ICON"
                  fallback="Fm"
                  aria-hidden="true"
                />
                <div class="db-forms-list__name">{{ form.name }}</div>
              </div>
              <div class="db-forms-list__meta">{{ form.fields.length }} fields</div>
            </div>
            <div class="db-forms-list__actions">
              <button class="db-form-open-btn" type="button" @click="activeViewId = form.id">
                Edit
              </button>
              <button
                v-if="!embedded && openFormPage"
                class="db-form-open-btn"
                type="button"
                @click="handleOpenFormFromList(form.id)"
              >
                Open form
              </button>
              <button
                v-if="canCreateForms"
                class="db-form-delete-btn"
                type="button"
                @click="deleteFormView(form)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
        </div>
        <div v-else class="db-form-builder">
          <FormBuilder :key="activeViewId" :database="formBuilderContext" />
        </div>
      </div>
    </div>
    <div
      v-if="addFieldMenu.open"
      ref="addFieldMenuRef"
      class="block-menu db-add-column-menu"
      :style="addFieldMenuStyle"
    >
      <div class="block-menu__panel-stack">
        <div class="block-menu__panel">
          <div class="db-field-menu__title">New column</div>
          <div class="db-add-column-menu__input">
            <input
              ref="addFieldNameRef"
              v-model="addFieldName"
              class="db-add-column-input"
              type="text"
              :placeholder="addFieldPlaceholder"
            />
          </div>
          <div v-if="addFieldLinkedFromChoices" class="block-menu__panel-scroll">
            <div class="block-menu__panel-header">
              <button class="block-menu__back" type="button" @click.stop="addFieldLinkedFromChoices = null">‹ Back</button>
              <span class="block-menu__panel-title">Linked from</span>
            </div>
            <button
              v-for="relation in addFieldLinkedFromChoices"
              :key="linkedFromKey(relation)"
              class="block-menu__item"
              type="button"
              @click="createFieldWithType('LINKED_FROM', { linkedFrom: relation })"
            >
              <span class="block-menu__icon">{{ fieldTypeIcons.LINKED_FROM }}</span>
              <span class="block-menu__text">
                <span class="block-menu__title">{{ relation.databaseTitle }} › {{ relation.fieldName }}</span>
              </span>
            </button>
          </div>
          <div v-else class="block-menu__panel-scroll">
            <button
              v-for="type in fieldTypes"
              :key="type.value"
              class="block-menu__item"
              type="button"
              @click="createFieldWithType(type.value)"
            >
              <span class="block-menu__icon">{{ fieldTypeIcons[type.value] || 'Tx' }}</span>
              <span class="block-menu__text">
                <span class="block-menu__title">{{ type.label }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="fieldMenu.open && activeField"
      ref="fieldMenuRef"
      class="db-field-menu block-menu"
      :style="menuStyle"
    >
      <div class="block-menu__panel-stack">
        <transition :name="menuDir === 'backward' ? 'block-menu-slide-back' : 'block-menu-slide'" mode="out-in">
          <div :key="panelState" class="block-menu__panel">
            <template v-if="panelState === 'root'">
              <div class="db-field-menu__input">
                <input
                  v-model="fieldNameDraft"
                  class="db-add-column-input"
                  type="text"
                  :placeholder="activeFieldPlaceholder"
                  :readonly="isFieldReadOnly(activeField)"
                  @blur="commitFieldName"
                  @keydown="handleFieldNameKeydown"
                />
              </div>
              <button
                v-if="!isFieldReadOnly(activeField) && !isFieldTypeLocked(activeField)"
                class="block-menu__item block-menu__item--submenu"
                type="button"
                @click.stop="openPanel('type')"
              >
                <span class="block-menu__icon">Ty</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">Type</span>
                </span>
                <span class="block-menu__chevron">›</span>
              </button>
              <button
                v-if="isSelectField(activeField) && !isFieldOptionsLocked(activeField) && !isFieldReadOnly(activeField)"
                class="block-menu__item block-menu__item--submenu"
                type="button"
                @click.stop="openOptionsPanel"
              >
                <span class="block-menu__icon">Opt</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">Options</span>
                </span>
                <span class="block-menu__chevron">›</span>
              </button>
              <button
                v-if="isRelationField(activeField) && !isFieldOptionsLocked(activeField) && !isFieldReadOnly(activeField)"
                class="block-menu__item block-menu__item--submenu"
                type="button"
                @click.stop="openRelationPanel"
              >
                <span class="block-menu__icon">Rel</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">Relation</span>
                </span>
                <span class="block-menu__chevron">›</span>
              </button>
              <button
                v-if="isLinkedFromField(activeField) && !isReadonly"
                class="block-menu__item block-menu__item--submenu"
                type="button"
                @click.stop="openLinkedFromPanel"
              >
                <span class="block-menu__icon">Lnk</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">Linked from</span>
                </span>
                <span class="block-menu__chevron">›</span>
              </button>
              <button
                v-if="canConfigureView"
                class="block-menu__item"
                type="button"
                :disabled="isHideDisabled(activeField.id)"
                @click="hideFieldFromView(activeField.id)"
              >
                <span class="block-menu__icon">
                  <i class="bi bi-eye-slash" aria-hidden="true"></i>
                </span>
                <span class="block-menu__text">
                  <span class="block-menu__title">Hide in this view</span>
                </span>
              </button>
              <div v-if="!isFieldReadOnly(activeField) && !isFieldDeleteLocked(activeField)" class="block-menu__group">
                <div class="block-menu__group-title">Danger</div>
                <button class="block-menu__item" type="button" @click="deleteField(activeField)">
                  <span class="block-menu__icon">×</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Delete column</span>
                  </span>
                </button>
              </div>
              <div v-if="!isReadonly && (canMoveBy(activeField.id, -1) || canMoveBy(activeField.id, 1))" class="block-menu__group">
                <div class="block-menu__group-title">Move</div>
                <button v-if="canMoveBy(activeField.id, -1)" class="block-menu__item" type="button" @click="moveActiveField(-1)">
                  <span class="block-menu__icon">←</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Move left</span>
                  </span>
                </button>
                <button v-if="canMoveBy(activeField.id, 1)" class="block-menu__item" type="button" @click="moveActiveField(1)">
                  <span class="block-menu__icon">→</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Move right</span>
                  </span>
                </button>
              </div>
              <div class="block-menu__group">
                <div class="block-menu__group-title">Sort</div>
                <button class="block-menu__item" type="button" @click="sortField(activeField.id, 'asc')">
                  <span class="block-menu__icon">A-Z</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Sort ascending</span>
                  </span>
                </button>
                <button class="block-menu__item" type="button" @click="sortField(activeField.id, 'desc')">
                  <span class="block-menu__icon">Z-A</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Sort descending</span>
                  </span>
                </button>
                <button class="block-menu__item" type="button" @click="clearSort">
                  <span class="block-menu__icon">--</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Clear sort</span>
                  </span>
                </button>
              </div>
            </template>
            <template v-else-if="panelState === 'type'">
              <div class="block-menu__panel-header">
                <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                <span class="block-menu__panel-title">Column type</span>
              </div>
              <div class="block-menu__panel-scroll">
                <button
                  v-for="type in fieldTypes"
                  :key="type.value"
                  class="block-menu__item"
                  type="button"
                  @click="setFieldType(activeField, type.value)"
                >
                  <span class="block-menu__icon">{{ fieldTypeIcons[type.value] || 'Tx' }}</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">{{ type.label }}</span>
                  </span>
                  <span v-if="activeField.type === type.value" class="db-field-menu__current">current</span>
                </button>
              </div>
            </template>
            <template v-else-if="panelState === 'options'">
              <div class="block-menu__panel-header">
                <button class="block-menu__back" type="button" @click.stop="closeOptionsPanel">‹ Back</button>
                <span class="block-menu__panel-title">Options</span>
              </div>
              <div class="block-menu__panel-scroll">
              <div class="db-options-list">
                <div v-if="!optionsDraft.length" class="db-options-empty">No options yet.</div>
                <div v-for="(option, index) in optionsDraft" :key="`opt-${index}`" class="db-option-row">
                  <input
                      v-if="activeField.type === 'MULTI_SELECT'"
                      class="db-option-color"
                      type="color"
                      :value="option.color || '#9ca3af'"
                      aria-label="Option color"
                      @input="updateOptionColor(index, $event.target.value)"
                    />
                    <input
                      ref="optionInputRefs"
                      class="db-add-column-input db-option-input"
                      type="text"
                      :value="option.value"
                      placeholder="Option"
                      @input="updateOptionValue(index, $event.target.value)"
                    />
                    <button class="db-option-remove" type="button" @click="removeOption(index)">×</button>
                  </div>
                </div>
                <button class="block-menu__item" type="button" @click="addOption">
                  <span class="block-menu__icon">+</span>
                  <span class="block-menu__text">
                    <span class="block-menu__title">Add option</span>
                  </span>
                </button>
                <div v-if="optionDependencyWarnings.length" class="db-options-warning">
                  <div class="db-options-warning__title">Used in forms</div>
                  <div
                    v-for="warning in optionDependencyWarnings"
                    :key="warning.value"
                    class="db-options-warning__item"
                  >
                    <div class="db-options-warning__value">{{ warning.value }}</div>
                    <div class="db-options-warning__meta">
                      Used in {{ warning.reasonsText }} on {{ warning.formsText }}.
                    </div>
                  </div>
                </div>
              </div>
            </template>
            <template v-else-if="panelState === 'relation'">
              <div class="block-menu__panel-header">
                <button class="block-menu__back" type="button" @click.stop="closeRelationPanel">‹ Back</button>
                <span class="block-menu__panel-title">Relation</span>
              </div>
              <div class="block-menu__panel-scroll db-relation-settings">
                <label class="db-relation-settings__field">
                  <span class="db-relation-settings__label">Target database</span>
                  <select v-model="relationDraftPageId" class="db-form-field-select db-relation-settings__select">
                    <option value="">Select database...</option>
                    <option v-for="page in relationTargetPages" :key="page.id" :value="page.id">
                      {{ page.title || 'Untitled database' }}
                    </option>
                  </select>
                  <span v-if="!relationTargetPages.length" class="db-relation-settings__hint">No databases available.</span>
                </label>
                <label class="db-relation-settings__check">
                  <input type="checkbox" v-model="relationDraftAllowMultiple" />
                  <span class="db-relation-settings__text">
                    <span class="db-relation-settings__title">Allow multiple</span>
                    <span class="db-relation-settings__hint">Link a row to more than one row</span>
                  </span>
                </label>
                <label class="db-relation-settings__check">
                  <input type="checkbox" v-model="relationDraftHistoryEnabled" />
                  <span class="db-relation-settings__text">
                    <span class="db-relation-settings__title">Track history</span>
                    <span class="db-relation-settings__hint">Keep an append-only log of changes</span>
                    <span v-if="relationDraftHistoryEnabled && relationDraftHistoryPageId" class="db-relation-settings__hint">
                      Logging to: {{ pageMap.get(relationDraftHistoryPageId)?.title || 'Relation history' }}
                    </span>
                  </span>
                </label>
              </div>
            </template>
            <template v-else-if="panelState === 'linkedFrom'">
              <div class="block-menu__panel-header">
                <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
                <span class="block-menu__panel-title">Linked from</span>
              </div>
              <div class="block-menu__panel-scroll db-relation-settings">
                <label class="db-relation-settings__field">
                  <span class="db-relation-settings__label">Rows linking here through</span>
                  <select
                    class="db-form-field-select db-relation-settings__select"
                    :value="activeLinkedFromKey"
                    :disabled="incomingRelationsLoading && !incomingRelations.length"
                    @change="chooseLinkedFrom($event.target.value)"
                  >
                    <option v-if="!incomingRelations.some((relation) => linkedFromKey(relation) === activeLinkedFromKey)" :value="activeLinkedFromKey">
                      {{ incomingRelationsLoading ? 'Loading...' : 'A relation that no longer points here' }}
                    </option>
                    <option v-for="relation in incomingRelations" :key="linkedFromKey(relation)" :value="linkedFromKey(relation)">
                      {{ relation.databaseTitle }} › {{ relation.fieldName }}
                    </option>
                  </select>
                  <span class="db-relation-settings__hint">Shows the rows of that database whose relation links to each row here. Change the links from there.</span>
                </label>
              </div>
            </template>
          </div>
        </transition>
      </div>
    </div>
    <div
      v-if="columnsMenu.open && hasViewConfig"
      ref="columnsMenuRef"
      class="block-menu db-columns-menu"
      :style="columnsMenuStyle"
    >
      <div class="block-menu__panel-stack">
        <div class="block-menu__panel">
          <div class="block-menu__panel-header">
            <span class="block-menu__panel-title">Columns</span>
          </div>
          <div class="block-menu__panel-scroll">
            <button
              v-for="field in fields"
              :key="field.id"
              class="block-menu__item db-columns-menu__item"
              type="button"
              :disabled="isHideDisabled(field.id)"
              @click="toggleFieldHidden(field.id)"
            >
              <span class="block-menu__icon">
                <i
                  :class="hiddenFieldIdSet.has(field.id) ? 'bi bi-eye-slash' : 'bi bi-eye'"
                  aria-hidden="true"
                ></i>
              </span>
              <span class="block-menu__text">
                <span class="block-menu__title">{{ field.name || 'Field' }}</span>
                <span class="db-columns-menu__hint">{{ hiddenFieldIdSet.has(field.id) ? 'Hidden' : 'Visible' }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="formMenu.open"
      ref="formMenuRef"
      class="block-menu db-form-menu"
      :style="formMenuStyle"
    >
      <div class="block-menu__panel-stack">
        <div class="block-menu__panel">
          <div class="block-menu__panel-header">
            <span class="block-menu__panel-title">Add view</span>
          </div>
          <div class="block-menu__panel-scroll">
            <button class="block-menu__item" type="button" @click="createSavedView('TABLE')">
              <span class="block-menu__icon"><i class="bi bi-table" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Table</span>
                <span class="block-menu__hint">Filter &amp; sort rows</span>
              </span>
            </button>
            <button class="block-menu__item" type="button" @click="createSavedView('GALLERY')">
              <span class="block-menu__icon"><i class="bi bi-grid-3x3-gap" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Gallery</span>
                <span class="block-menu__hint">Cards</span>
              </span>
            </button>
            <button class="block-menu__item" type="button" @click="createSavedView('LIST')">
              <span class="block-menu__icon"><i class="bi bi-list-ul" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">List</span>
                <span class="block-menu__hint">One row per line</span>
              </span>
            </button>
            <button class="block-menu__item" type="button" @click="createSavedView('BOARD')">
              <span class="block-menu__icon"><i class="bi bi-kanban" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Board</span>
                <span class="block-menu__hint">Group by a select field</span>
              </span>
            </button>
            <div class="block-menu__separator" role="separator"></div>
            <button class="block-menu__item" type="button" @click="createFormView">
              <span class="block-menu__icon"><i class="bi bi-pencil-square" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Form</span>
                <span class="block-menu__hint">Collect submissions</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="filterMenu.open && activeSavedView"
      ref="filterMenuRef"
      class="block-menu db-view-config-menu"
      :style="filterMenuStyle"
    >
      <div class="db-view-config__header">
        <span class="db-view-config__title">Filters</span>
        <div class="db-view-config__match" v-if="activeViewFilters.rules.length > 1">
          <span class="db-view-config__match-label">Match</span>
          <button
            class="db-view-config__match-btn"
            :class="{ 'db-view-config__match-btn--active': activeViewFilters.match === 'AND' }"
            type="button"
            @click="setFilterMatch('AND')"
          >
            All
          </button>
          <button
            class="db-view-config__match-btn"
            :class="{ 'db-view-config__match-btn--active': activeViewFilters.match === 'OR' }"
            type="button"
            @click="setFilterMatch('OR')"
          >
            Any
          </button>
        </div>
      </div>
      <div class="db-view-config__body">
        <div v-if="!activeViewFilters.rules.length" class="db-view-config__empty muted">No filters yet.</div>
        <div v-for="(rule, index) in activeViewFilters.rules" :key="index" class="db-view-config__rule">
          <select
            class="db-view-config__select"
            :value="rule.fieldId"
            @change="changeFilterRuleField(index, $event.target.value)"
          >
            <option v-for="field in fields" :key="field.id" :value="field.id">{{ field.name || 'Field' }}</option>
          </select>
          <select
            class="db-view-config__select"
            :value="rule.operator"
            @change="updateFilterRule(index, { operator: $event.target.value })"
          >
            <option
              v-for="op in operatorsForFieldType(fieldById.get(rule.fieldId)?.type)"
              :key="op"
              :value="op"
            >
              {{ OPERATOR_LABELS[op] }}
            </option>
          </select>
          <template v-if="operatorNeedsValue(rule.operator)">
            <select
              v-if="['SELECT', 'MULTI_SELECT'].includes(fieldById.get(rule.fieldId)?.type)"
              class="db-view-config__value"
              :value="rule.value ?? ''"
              @change="updateFilterRule(index, { value: $event.target.value })"
            >
              <option value="">Select value</option>
              <option v-for="choice in fieldChoices(fieldById.get(rule.fieldId))" :key="choice.value" :value="choice.label">
                {{ choice.label }}
              </option>
            </select>
            <input
              v-else
              class="db-view-config__value"
              :type="fieldById.get(rule.fieldId)?.type === 'NUMBER' ? 'number' : fieldById.get(rule.fieldId)?.type === 'DATE' ? 'date' : 'text'"
              :value="rule.value ?? ''"
              placeholder="Value"
              @input="updateFilterRule(index, { value: $event.target.value })"
            />
          </template>
          <button class="db-view-config__remove" type="button" aria-label="Remove filter" @click="removeFilterRule(index)">
            ×
          </button>
        </div>
      </div>
      <div class="db-view-config__footer">
        <button class="db-view-config__add" type="button" @click="addFilterRule">+ Add filter</button>
      </div>
    </div>
    <div
      v-if="sortMenu.open && activeSavedView"
      ref="sortMenuRef"
      class="block-menu db-view-config-menu"
      :style="sortMenuStyle"
    >
      <div class="db-view-config__header">
        <span class="db-view-config__title">Sort</span>
      </div>
      <div class="db-view-config__body">
        <div v-if="!activeViewSorts.length" class="db-view-config__empty muted">No sorts yet.</div>
        <div v-for="(sort, index) in activeViewSorts" :key="index" class="db-view-config__rule">
          <select
            class="db-view-config__select"
            :value="sort.fieldId"
            @change="updateSortRule(index, { fieldId: $event.target.value })"
          >
            <option v-for="field in fields" :key="field.id" :value="field.id">{{ field.name || 'Field' }}</option>
          </select>
          <select
            class="db-view-config__select"
            :value="sort.direction"
            @change="updateSortRule(index, { direction: $event.target.value })"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
          <button class="db-view-config__remove" type="button" aria-label="Remove sort" @click="removeSortRule(index)">
            ×
          </button>
        </div>
      </div>
      <div class="db-view-config__footer">
        <button class="db-view-config__add" type="button" @click="addSortRule">+ Add sort</button>
      </div>
    </div>
    <div
      v-if="multiSelectMenu.open && activeMultiSelectField && activeMultiSelectRow"
      ref="multiSelectMenuRef"
      class="block-menu db-multi-select-menu"
      :style="multiSelectMenuStyle"
    >
      <div class="block-menu__panel-stack">
        <div class="block-menu__panel">
          <div class="block-menu__panel-scroll">
            <div
              v-if="activeMultiSelectField?.type === 'RELATION' && activeMultiSelectRelationLoading"
              class="db-options-empty"
            >
              Loading relation options...
            </div>
            <div
              v-else-if="activeMultiSelectField?.type === 'RELATION' && activeMultiSelectRelationError"
              class="db-options-empty"
            >
              {{ activeMultiSelectRelationError }}
            </div>
            <div v-else-if="membersLoading && isMembersField(activeMultiSelectField)" class="db-options-empty">Loading members...</div>
            <div v-else-if="!activeMultiSelectChoices.length" class="db-options-empty">No options yet.</div>
            <button
              v-for="choice in activeMultiSelectChoices"
              :key="choice.value"
              class="block-menu__item db-multi-option"
              type="button"
              @click="toggleMultiSelectOption(choice.value)"
            >
              <span class="db-option-color-dot" :style="multiSelectDotStyle(choice.color)"></span>
              <span class="block-menu__text">
                <span class="block-menu__title">{{ choice.label || choice.value }}</span>
              </span>
              <span v-if="isMultiSelectOptionSelected(choice.value)" class="db-option-selected">selected</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="viewMenu.open && viewMenuView"
      ref="viewMenuRef"
      class="block-menu db-row-menu db-view-menu"
      :style="viewMenuStyle"
    >
      <div class="block-menu__panel-stack">
        <div class="block-menu__panel">
          <div class="block-menu__panel-scroll">
            <button class="block-menu__item" type="button" @click="renameViewFromMenu">
              <span class="block-menu__icon"><i class="bi bi-pencil" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Rename view</span>
              </span>
            </button>
            <button class="block-menu__item" type="button" @click="deleteViewFromMenu">
              <span class="block-menu__icon">×</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Delete view</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-if="rowMenu.open && activeRowMenuRow"
      ref="rowMenuRef"
      class="block-menu db-row-menu"
      :style="rowMenuStyle"
    >
      <div class="block-menu__panel-stack">
        <div class="block-menu__panel">
          <div class="block-menu__panel-scroll">
            <button class="block-menu__item" type="button" @click="deleteRow(activeRowMenuRow)">
              <span class="block-menu__icon">×</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Delete row</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="assetTagPreview.open" class="modal-backdrop" @click.self="closeAssetTagPreview">
      <div class="modal-card db-qr-modal">
        <h3>Asset tag</h3>
        <p class="muted">Scan or copy the tag ID for this record.</p>
        <div v-if="assetTagPreview.loading" class="muted">Generating QR code...</div>
        <div v-else-if="assetTagPreview.error" class="alert">{{ assetTagPreview.error }}</div>
        <div v-else class="db-qr-modal__preview">
          <img :src="assetTagPreview.dataUrl" alt="QR code" />
        </div>
        <div class="db-qr-modal__code">{{ assetTagPreview.value }}</div>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="closeAssetTagPreview">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>
