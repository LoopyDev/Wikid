<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, h, inject } from 'vue';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import {
  FlexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useVueTable,
} from '@tanstack/vue-table';
import QRCode from 'qrcode';
import { api } from '../api/client';
import { formatDateTime } from '../utils/date-format';
import { useWorkspaceStore } from '../stores/workspace';
import PageIcon from './PageIcon.vue';
import DatabaseFormPage from './DatabaseFormPage.vue';

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
const collabDoc = ref(null);
const collabProvider = ref(null);
const currentCollabDocName = ref(null);
const collabSynced = ref(false);
const collabSeeded = ref(false);
const collabFieldsMap = ref(null);
const collabRowsMap = ref(null);
const collabFieldOrder = ref(null);
const collabRowOrder = ref(null);
const collabObserver = ref(null);
const collabApplyScheduled = ref(false);
const lastLoadedSnapshot = ref(null);
const formViews = ref([]);
const savedViews = ref([]);
const activeViewId = ref('table');
const filterMenu = ref({ open: false, x: 0, y: 0 });
const filterMenuRef = ref(null);
const sortMenu = ref({ open: false, x: 0, y: 0 });
const sortMenuRef = ref(null);
const formFieldSelectId = ref('');
const formBuilderTab = ref('fields');
const formBuilderTabs = [
  { id: 'fields', label: 'Fields' },
  { id: 'rules', label: 'Rules' },
  { id: 'layout', label: 'Layout' },
];
const newRuleTargetFieldId = ref('');
const newRuleConditionFieldId = ref('');
const newVisibilityTargetFieldId = ref('');
const newVisibilityConditionFieldId = ref('');
const isReadonly = computed(() => props.readonly);
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
const AUDIT_VIEW_ID = 'audit';
const canCreateForms = computed(() => !props.embedded && !isReadonly.value);
const activeForm = computed(() => formViews.value.find((form) => form.id === activeViewId.value) || null);
const activeSavedView = computed(() => savedViews.value.find((view) => view.id === activeViewId.value) || null);
const activeViewType = computed(() => activeSavedView.value?.type || null);
const isTableView = computed(() => activeViewId.value === 'table');
const isFormsView = computed(() => activeViewId.value === 'forms');
const isComplianceDatabase = computed(() => databasePage.value?.databaseComplianceMode === true);
const canShowAudit = computed(() => !props.embedded && isComplianceDatabase.value);
const isAuditView = computed(() => activeViewId.value === AUDIT_VIEW_ID);
const isGalleryView = computed(() => activeViewType.value === 'GALLERY');
const isBoardView = computed(() => activeViewType.value === 'BOARD');
// Table markup is shared by the built-in Table tab, the Audit view, and any
// saved view of type TABLE.
const showTableView = computed(() => isTableView.value || isAuditView.value || activeViewType.value === 'TABLE');
const showFormTabs = computed(
  () =>
    !props.embedded &&
    (formViews.value.length > 0 || savedViews.value.length > 0 || canCreateForms.value || canShowAudit.value)
);
const DEFAULT_FORM_ICON = 'icon:pencil-square';
const auditStatusOptions = [
  { id: 'DRAFT', label: 'Draft', tone: 'draft' },
  { id: 'SUBMITTED', label: 'Submitted', tone: 'submitted' },
  { id: 'REVIEW', label: 'In Review', tone: 'review' },
  { id: 'CLOSED', label: 'Closed', tone: 'closed' },
  { id: 'ARCHIVED', label: 'Archived', tone: 'archived' },
];
const GOVERNANCE_FILTER_ID = '__governanceStatus__';
const governanceFilterChoices = auditStatusOptions.map((status) => ({
  value: status.id,
  label: status.label,
}));
const governanceFilterOption = { id: GOVERNANCE_FILTER_ID, name: 'Governance status', type: 'Status' };
const DEFAULT_INITIAL_STATUS = 'SUBMITTED';
const auditStatusIds = new Set(auditStatusOptions.map((status) => status.id));
const auditStatusClassById = Object.fromEntries(auditStatusOptions.map((status) => [status.id, status.tone]));
const COMPLIANCE_RECORD_KEY = '__complianceRecordId';
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

const fieldTypes = [
  { value: 'TEXT', label: 'Text' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'DATE', label: 'Date' },
  { value: 'CHECKBOX', label: 'Checkbox' },
  { value: 'SELECT', label: 'Select' },
  { value: 'MULTI_SELECT', label: 'Multi-select' },
  { value: 'RELATION', label: 'Relation' },
  { value: 'URL', label: 'URL' },
];
const fieldTypeIcons = {
  TEXT: 'Tx',
  NUMBER: '#',
  DATE: 'Dt',
  CHECKBOX: '[]',
  SELECT: 'Sel',
  MULTI_SELECT: 'Mul',
  RELATION: 'Rel',
  URL: 'URL',
};
const COLUMN_DEFAULT_SIZE = 180;
const COLUMN_MIN_SIZE = 120;
const COLUMN_MAX_SIZE = 1220;
const ROW_ID_COLUMN_ID = '__row_id__';
const ROW_ID_COLUMN_LABEL = 'Item ID';
const ROW_ID_COLUMN_SIZE = 260;
const ROW_ID_COLUMN_MIN_SIZE = 200;
const ASSET_TAG_COLUMN_SIZE = 140;
const ADD_COLUMN_ID = '__add_column__';
const ADD_COLUMN_LABEL = 'Add';
const ADD_COLUMN_SIZE = 120;
const AUTO_SIZE_CHAR_LIMIT = 30;
const AUTO_SIZE_CHAR_WIDTH = 8.5;
const AUTO_SIZE_BASE = 26;
const AUTO_SIZE_FIRST_EXTRA = 26;
const AUTO_SIZE_PAGE_ICON_EXTRA = 30;
const AUTO_SIZE_BUFFER = 8;
const AUTO_SIZE_SELECT_PLACEHOLDER = 'Select...';
const AUTO_SIZE_RELATION_PLACEHOLDER = 'Select record...';
const AUTO_SIZE_RELATION_MULTI_PLACEHOLDER = 'Select records...';
const AUTO_SIZE_MULTI_PLACEHOLDER = 'Add option';
const AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER = 'Add person';
const AUTO_SIZE_SELECT_EXTRA = 24;
const AUTO_SIZE_MULTI_PILL_PADDING = 18;
const AUTO_SIZE_MULTI_PILL_GAP = 6;
const formatFieldType = (type) => fieldTypes.find((entry) => entry.value === type)?.label || type || 'Field';

const hasApi = computed(() => workspace.hasApi);
const activeUser = computed(() => workspace.activeUser);
const membersMap = computed(() => new Map(workspaceMembers.value.map((member) => [member.id, member.name])));
const presencePalette = ['#f97316', '#22d3ee', '#a855f7', '#ef4444', '#10b981', '#facc15', '#14b8a6', '#3b82f6', '#f472b6'];
const colorFromId = (id = '') => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % presencePalette.length;
  return presencePalette[idx];
};
const localPresenceId = computed(() => activeUser.value?.id || null);
const presenceUser = computed(() => ({
  id: activeUser.value?.id || 'guest',
  name: activeUser.value?.name || 'Guest',
  color: colorFromId(activeUser.value?.id || 'guest'),
}));
const collabContext = computed(() => {
  if (isComplianceDatabase.value) return null;
  const override = props.collab && typeof props.collab === 'object' ? props.collab : null;
  if (override?.docName && override?.token && override?.url) {
    return { docName: override.docName, token: override.token, url: override.url };
  }
  if (!workspace.collabDocName || !workspace.collabToken || !workspace.collabUrl) return null;
  if (!workspace.collabDocName.includes(':db:')) return null;
  return { docName: workspace.collabDocName, token: workspace.collabToken, url: workspace.collabUrl };
});
const isCollabEnabled = computed(() => !!collabContext.value);
const collabCellPresence = ref([]);
const collabAwarenessSource = ref(null);
const collabAwarenessHandler = ref(null);
let localTypingTimer = null;
let lastLocalCursor = null;
const cellInputRefs = new Map();
let caretMeasureCanvas = null;

const normalizeChoice = (choice) => {
  if (typeof choice === 'string') {
    const value = choice.trim();
    return value ? { value, color: null } : null;
  }
  if (choice && typeof choice === 'object') {
    const value = typeof choice.value === 'string' ? choice.value.trim() : '';
    if (!value) return null;
    const label = typeof choice.label === 'string' ? choice.label.trim() : '';
    const color = typeof choice.color === 'string' && choice.color.trim() ? choice.color.trim() : null;
    return { value, label: label || null, color };
  }
  return null;
};

const normalizeFieldOptions = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  const rawChoices = Array.isArray(options.choices) ? options.choices : [];
  const choices = rawChoices.map(normalizeChoice).filter(Boolean);
  return { ...options, choices };
};

const getFieldSource = (field) => normalizeFieldOptions(field).source || null;
const isMembersField = (field) => getFieldSource(field) === 'members';
const isPageField = (field) => getFieldSource(field) === 'page';
const isLastEditedField = (field) => getFieldSource(field) === 'lastEdited';
const isAssetTagField = (field) => getFieldSource(field) === 'assetTag';
const isRelationField = (field) => field?.type === 'RELATION';
const getRelationConfig = (field) => {
  const options = normalizeFieldOptions(field);
  const relation = options?.relation;
  if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null;
  const pageId = typeof relation.pageId === 'string' ? relation.pageId.trim() : '';
  if (!pageId) return null;
  const rawHistory = relation.history;
  let history = null;
  if (rawHistory === true) {
    history = { enabled: true, pageId: '' };
  } else if (rawHistory && typeof rawHistory === 'object' && !Array.isArray(rawHistory) && rawHistory.enabled === true) {
    const historyPageId = typeof rawHistory.pageId === 'string' ? rawHistory.pageId.trim() : '';
    history = { enabled: true, pageId: historyPageId || '' };
  }
  return { pageId, allowMultiple: relation.allowMultiple === true, history };
};
const isSystemField = (field) => {
  const source = getFieldSource(field);
  return source === 'page' || source === 'members' || source === 'lastEdited';
};
const isFieldTypeLocked = (field) => isSystemField(field) || isAssetTagField(field);
const isFieldOptionsLocked = (field) => isSystemField(field) || isAssetTagField(field);
const isFieldDeleteLocked = (field) => isSystemField(field);
const isFieldReadOnly = (field) => {
  const options = normalizeFieldOptions(field);
  if (options.source === 'lastEdited') return true;
  if (options.source === 'page') return !!options.readonly;
  return !!options.readonly;
};
const isPageFieldEditable = (field) => isPageField(field) && !normalizeFieldOptions(field).readonly;
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

const buildFormField = (field) => ({
  fieldId: field.id,
  label: null,
  required: false,
  editable: true,
  auto: null,
  selectSource: null,
  requiredWhen: null,
  visibleWhen: null,
});

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

const selectSourceValueOptions = (selectSource) => {
  if (!selectSource || selectSource.type !== 'relation') return [];
  const relationFieldId =
    typeof selectSource.relationFieldId === 'string' ? selectSource.relationFieldId.trim() : '';
  const targetFieldId = typeof selectSource.targetFieldId === 'string' ? selectSource.targetFieldId.trim() : '';
  if (!relationFieldId || !targetFieldId) return [];
  const relationField = relationFieldId ? fieldById.value.get(relationFieldId) : null;
  const relation = relationField ? getRelationConfig(relationField) : null;
  if (!relation?.pageId) return [];
  const rows = relationRowsForPage(relation.pageId);
  const seen = new Set();
  return rows
    .map((row) => {
      const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
      const label = stringifyValue(data[targetFieldId]);
      if (!label) return null;
      const value = String(label);
      if (seen.has(value)) return null;
      seen.add(value);
      return { value, label: value };
    })
    .filter(Boolean);
};

const getAutoFixedChoices = (fieldId, selectSource) => {
  const field = fieldId ? fieldById.value.get(fieldId) : null;
  if (!field) return [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation?.pageId) return [];
    return relationOptionsForPage(relation.pageId).map((option) => ({
      value: option.id,
      label: option.label || option.id,
    }));
  }
  if (field.type !== 'SELECT') return [];
  if (selectSource?.type === 'relation') {
    return selectSourceValueOptions(selectSource);
  }
  return normalizeFieldOptions(field).choices;
};

const normalizeRequiredWhenOp = (op) => {
  if (op === 'equals' || op === 'isFilled' || op === 'isEmpty') return op;
  return '';
};

const buildRequiredWhenCondition = (conditionFieldId, op, value) => {
  const trimmed = typeof conditionFieldId === 'string' ? conditionFieldId.trim() : '';
  if (!trimmed) return null;
  const conditionField = fieldById.value.get(trimmed);
  if (!conditionField) return null;
  const normalizedOp = normalizeRequiredWhenOp(op);
  if (!normalizedOp) return null;
  if (normalizedOp === 'equals') {
    if (conditionField.type !== 'SELECT') return null;
    const choices = normalizeFieldOptions(conditionField).choices;
    if (!choices.length) return null;
    const rawValue = typeof value === 'string' ? value.trim() : '';
    const nextValue = rawValue && choices.some((choice) => choice.value === rawValue) ? rawValue : choices[0].value;
    if (!nextValue) return null;
    return { fieldId: trimmed, op: normalizedOp, value: nextValue };
  }
  return { fieldId: trimmed, op: normalizedOp };
};

const getConditionOpOptions = (fieldType, hasChoices) => {
  const options = [];
  if (fieldType === 'SELECT' && hasChoices) {
    options.push({ value: 'equals', label: 'Equals' });
  }
  options.push({ value: 'isFilled', label: 'Value is filled' }, { value: 'isEmpty', label: 'Value is empty' });
  return options;
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

const normalizeFormIcon = (rawIcon) => {
  if (typeof rawIcon !== 'string') return DEFAULT_FORM_ICON;
  const trimmed = rawIcon.trim();
  return trimmed ? trimmed : DEFAULT_FORM_ICON;
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

const updateFormView = (formId, updater) => {
  if (!formId || typeof updater !== 'function') return;
  formViews.value = formViews.value.map((form) => (form.id === formId ? updater(form) : form));
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

const saveFormFields = async (formId, nextFields) => {
  if (!hasApi.value || !activeUser.value) return null;
  try {
    const res = await runWithSavingIndicator(() =>
      api.updateDatabaseForm(
        formId,
        { fields: nextFields },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    const nextForm = normalizeFormView(res);
    if (nextForm) {
      updateFormView(nextForm.id, () => nextForm);
    }
    return nextForm || null;
  } catch (err) {
    console.warn('Update form failed', err);
    error.value = err?.message || 'Failed to update form';
    return null;
  }
};

const saveFormConfig = async (formId, nextConfig) => {
  if (!hasApi.value || !activeUser.value) return null;
  try {
    const res = await runWithSavingIndicator(() =>
      api.updateDatabaseForm(
        formId,
        { config: nextConfig },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      )
    );
    const nextForm = normalizeFormView(res);
    if (nextForm) {
      updateFormView(nextForm.id, () => nextForm);
    }
    return nextForm || null;
  } catch (err) {
    console.warn('Update form failed', err);
    error.value = err?.message || 'Failed to update form';
    return null;
  }
};

const activeFormConfig = computed(() => normalizeFormConfig(activeForm.value?.config));

const updateFormMode = async (mode) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const nextMode = mode === 'update' ? 'update' : 'create';
  const current = activeFormConfig.value;
  const nextConfig = {
    ...current,
    mode: nextMode,
    filter: nextMode === 'update' ? current.filter : null,
    ...(nextMode === 'update' ? {} : { transitionStatus: null }),
  };
  await saveFormConfig(form.id, nextConfig);
};

const updateFormFilterField = async (fieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  const nextFieldId = typeof fieldId === 'string' ? fieldId : '';
  const filter = nextFieldId
    ? { fieldId: nextFieldId, op: current.filter?.op || 'isEmpty', value: current.filter?.value ?? '' }
    : null;
  await saveFormConfig(form.id, { ...current, filter });
};

const updateFormFilterOp = async (op) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  if (!current.filter) return;
  await saveFormConfig(form.id, { ...current, filter: { ...current.filter, op } });
};

const updateFormFilterValue = async (value) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  if (!current.filter) return;
  await saveFormConfig(form.id, { ...current, filter: { ...current.filter, value } });
};

const updateFormSuccessMessage = async (message) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  await saveFormConfig(form.id, { ...current, successMessage: message });
};

const updateFormShowReturnButton = async (value) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const current = activeFormConfig.value;
  await saveFormConfig(form.id, { ...current, showReturnButton: value === true });
};

const updateFormInitialStatus = async (status) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const rawStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  const initialStatus = auditStatusIds.has(rawStatus) ? rawStatus : DEFAULT_INITIAL_STATUS;
  const current = activeFormConfig.value;
  await saveFormConfig(form.id, { ...current, initialStatus });
};

const updateFormTransitionStatus = async (status) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form) return;
  const rawStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  const transitionStatus = auditStatusIds.has(rawStatus) ? rawStatus : '';
  const current = activeFormConfig.value;
  const nextConfig = { ...current };
  if (transitionStatus) {
    nextConfig.transitionStatus = transitionStatus;
  } else {
    delete nextConfig.transitionStatus;
  }
  await saveFormConfig(form.id, nextConfig);
};

const addFieldToActiveForm = async () => {
  const form = activeForm.value;
  const fieldId = formFieldSelectId.value;
  if (!form || !fieldId) return;
  const field = fields.value.find((item) => item.id === fieldId);
  if (!field) return;
  if (form.fields.some((entry) => entry.fieldId === fieldId)) {
    formFieldSelectId.value = '';
    return;
  }
  if (!hasApi.value || !activeUser.value) return;
  const nextFields = [...form.fields, buildFormField(field)];
  formFieldSelectId.value = '';
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoType = async (fieldId, nextType) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  let nextAuto = null;
  if (nextType === 'currentUser') {
    nextAuto = { type: 'currentUser' };
  } else if (nextType === 'template') {
    const current = form.fields.find((entry) => entry.fieldId === fieldId)?.auto;
    const template =
      current && typeof current === 'object' && typeof current.template === 'string' && current.template.trim()
        ? current.template.trim()
        : '{{counter}}';
    nextAuto = { type: 'template', template };
  } else if (nextType === 'fixed') {
    const entry = form.fields.find((entry) => entry.fieldId === fieldId);
    const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
    const choices = getAutoFixedChoices(fieldId, selectSource);
    const current = entry?.auto;
    const currentValue =
      current && typeof current === 'object' && typeof current.value === 'string' ? current.value.trim() : '';
    const value =
      currentValue && choices.some((choice) => choice.value === currentValue) ? currentValue : choices[0]?.value || '';
    if (value) {
      nextAuto = { type: 'fixed', value };
    }
  }
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoTemplate = async (fieldId, template) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const entry = form.fields.find((entry) => entry.fieldId === fieldId);
  const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
  const nextAuto = normalizeFormAuto({ type: 'template', template }, fieldId, selectSource);
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoMode = async (fieldId, mode) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const entry = form.fields.find((entry) => entry.fieldId === fieldId);
  const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
  const nextAuto = normalizeFormAuto({ type: 'currentUser', mode }, fieldId, selectSource);
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldAutoFixedValue = async (fieldId, value) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const entry = form.fields.find((entry) => entry.fieldId === fieldId);
  const selectSource = normalizeFormSelectSource(entry?.selectSource, fieldId);
  const nextAuto = normalizeFormAuto({ type: 'fixed', value }, fieldId, selectSource);
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextAuto) {
      nextEntry.auto = nextAuto;
    } else {
      delete nextEntry.auto;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldSelectSourceType = async (fieldId, nextType) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const type = nextType === 'relation' ? 'relation' : 'manual';
  const nextFields = await Promise.all(
    form.fields.map(async (entry) => {
      if (entry.fieldId !== fieldId) return entry;
      const nextEntry = { ...entry };
      if (type !== 'relation') {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      const relationFields = formSelectSourceRelations.value;
      if (!relationFields.length) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      let relationFieldId = relationFields[0]?.id || '';
      if (!relationFieldId) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      const relationField = fieldById.value.get(relationFieldId);
      const relation = relationField ? getRelationConfig(relationField) : null;
      if (!relation?.pageId) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      if (!relationFieldsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
        await loadRelationOptions(relation.pageId);
      }
      const targets = relationFieldsForPage(relation.pageId);
      const targetFieldId = targets[0]?.id || '';
      if (!targetFieldId) {
        delete nextEntry.selectSource;
        return nextEntry;
      }
      nextEntry.selectSource = { type: 'relation', relationFieldId, targetFieldId };
      return nextEntry;
    })
  );
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldSelectSourceRelation = async (fieldId, relationFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextRelationId = typeof relationFieldId === 'string' ? relationFieldId.trim() : '';
  if (!nextRelationId) {
    const nextFields = form.fields.map((entry) => {
      if (entry.fieldId !== fieldId) return entry;
      const nextEntry = { ...entry };
      delete nextEntry.selectSource;
      return nextEntry;
    });
    await saveFormFields(form.id, nextFields);
    return;
  }
  const relationField = fieldById.value.get(nextRelationId) || null;
  const relation = relationField ? getRelationConfig(relationField) : null;
  if (!relation?.pageId) {
    const nextFields = form.fields.map((entry) => {
      if (entry.fieldId !== fieldId) return entry;
      const nextEntry = { ...entry };
      delete nextEntry.selectSource;
      return nextEntry;
    });
    await saveFormFields(form.id, nextFields);
    return;
  }
  if (!relationFieldsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
    await loadRelationOptions(relation.pageId);
  }
  const targets = relationFieldsForPage(relation.pageId);
  const nextTargetId = targets[0]?.id || '';
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextRelationId && nextTargetId) {
      nextEntry.selectSource = { type: 'relation', relationFieldId: nextRelationId, targetFieldId: nextTargetId };
    } else {
      delete nextEntry.selectSource;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldSelectSourceTarget = async (fieldId, targetFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextTargetId = typeof targetFieldId === 'string' ? targetFieldId : '';
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    const current = entry?.selectSource;
    const relationFieldId =
      current && typeof current === 'object' && typeof current.relationFieldId === 'string' ? current.relationFieldId : '';
    if (relationFieldId && nextTargetId) {
      nextEntry.selectSource = { type: 'relation', relationFieldId, targetFieldId: nextTargetId };
    } else {
      delete nextEntry.selectSource;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldEditable = async (fieldId, editable) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextEditable = editable === false ? false : true;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    return { ...entry, editable: nextEditable };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequired = async (fieldId, required) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextRequired = !!required;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    return { ...entry, required: nextRequired };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequiredWhenField = async (fieldId, conditionFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const trimmed = typeof conditionFieldId === 'string' ? conditionFieldId.trim() : '';
  const conditionField = trimmed ? fieldById.value.get(trimmed) : null;
  const choices = conditionField && conditionField.type === 'SELECT' ? normalizeFieldOptions(conditionField).choices : [];
  const nextCondition =
    trimmed && conditionField
      ? choices.length
        ? buildRequiredWhenCondition(trimmed, 'equals', choices[0].value)
        : buildRequiredWhenCondition(trimmed, 'isFilled')
      : null;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextCondition) {
      nextEntry.requiredWhen = nextCondition;
    } else {
      delete nextEntry.requiredWhen;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequiredWhenValue = async (fieldId, nextValue) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.requiredWhen || typeof entry.requiredWhen !== 'object' || Array.isArray(entry.requiredWhen)) return entry;
    if (entry.requiredWhen.op !== 'equals') return entry;
    const value = typeof nextValue === 'string' ? nextValue.trim() : '';
    if (!value) {
      const nextEntry = { ...entry };
      delete nextEntry.requiredWhen;
      return nextEntry;
    }
    return { ...entry, requiredWhen: { ...entry.requiredWhen, value } };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldRequiredWhenOp = async (fieldId, op) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextOp = normalizeRequiredWhenOp(op);
  if (!nextOp) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.requiredWhen || typeof entry.requiredWhen !== 'object' || Array.isArray(entry.requiredWhen)) return entry;
    const conditionFieldId = typeof entry.requiredWhen.fieldId === 'string' ? entry.requiredWhen.fieldId.trim() : '';
    if (!conditionFieldId) return entry;
    const nextCondition = buildRequiredWhenCondition(conditionFieldId, nextOp, entry.requiredWhen.value);
    if (!nextCondition) {
      const nextEntry = { ...entry };
      delete nextEntry.requiredWhen;
      return nextEntry;
    }
    return { ...entry, requiredWhen: nextCondition };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldVisibleWhenField = async (fieldId, conditionFieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const trimmed = typeof conditionFieldId === 'string' ? conditionFieldId.trim() : '';
  const conditionField = trimmed ? fieldById.value.get(trimmed) : null;
  const choices = conditionField && conditionField.type === 'SELECT' ? normalizeFieldOptions(conditionField).choices : [];
  const nextCondition =
    trimmed && conditionField
      ? choices.length
        ? buildRequiredWhenCondition(trimmed, 'equals', choices[0].value)
        : buildRequiredWhenCondition(trimmed, 'isFilled')
      : null;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    const nextEntry = { ...entry };
    if (nextCondition) {
      nextEntry.visibleWhen = nextCondition;
    } else {
      delete nextEntry.visibleWhen;
    }
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldVisibleWhenValue = async (fieldId, nextValue) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.visibleWhen || typeof entry.visibleWhen !== 'object' || Array.isArray(entry.visibleWhen)) return entry;
    if (entry.visibleWhen.op !== 'equals') return entry;
    const value = typeof nextValue === 'string' ? nextValue.trim() : '';
    if (!value) {
      const nextEntry = { ...entry };
      delete nextEntry.visibleWhen;
      return nextEntry;
    }
    return { ...entry, visibleWhen: { ...entry.visibleWhen, value } };
  });
  await saveFormFields(form.id, nextFields);
};

const updateFormFieldVisibleWhenOp = async (fieldId, op) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextOp = normalizeRequiredWhenOp(op);
  if (!nextOp) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.visibleWhen || typeof entry.visibleWhen !== 'object' || Array.isArray(entry.visibleWhen)) return entry;
    const conditionFieldId = typeof entry.visibleWhen.fieldId === 'string' ? entry.visibleWhen.fieldId.trim() : '';
    if (!conditionFieldId) return entry;
    const nextCondition = buildRequiredWhenCondition(conditionFieldId, nextOp, entry.visibleWhen.value);
    if (!nextCondition) {
      const nextEntry = { ...entry };
      delete nextEntry.visibleWhen;
      return nextEntry;
    }
    return { ...entry, visibleWhen: nextCondition };
  });
  await saveFormFields(form.id, nextFields);
};

const reorderFormFields = async (fromId, toId, position) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fromId || !toId || fromId === toId) return;
  const fromIndex = form.fields.findIndex((entry) => entry.fieldId === fromId);
  if (fromIndex < 0) return;
  const nextFields = [...form.fields];
  const [entry] = nextFields.splice(fromIndex, 1);
  const targetIndex = nextFields.findIndex((field) => field.fieldId === toId);
  if (targetIndex < 0) {
    nextFields.push(entry);
  } else {
    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    nextFields.splice(insertIndex, 0, entry);
  }
  await saveFormFields(form.id, nextFields);
};

const formFieldDragId = ref('');
const formFieldDragOverId = ref('');
const formFieldDragOverPosition = ref('before');

const clearFormFieldDrag = () => {
  formFieldDragId.value = '';
  formFieldDragOverId.value = '';
  formFieldDragOverPosition.value = 'before';
};

const handleFormFieldDragStart = (fieldId, event) => {
  if (!canCreateForms.value) return;
  formFieldDragId.value = fieldId;
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', fieldId);
  }
};

const handleFormFieldDragOver = (fieldId, event) => {
  if (!canCreateForms.value || !formFieldDragId.value) return;
  event?.preventDefault?.();
  formFieldDragOverId.value = fieldId;
  if (event?.currentTarget?.getBoundingClientRect) {
    const rect = event.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    formFieldDragOverPosition.value = event.clientY >= midpoint ? 'after' : 'before';
  }
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
};

const handleFormFieldDragLeave = (fieldId, event) => {
  if (formFieldDragOverId.value !== fieldId) return;
  const related = event?.relatedTarget;
  const current = event?.currentTarget;
  if (related && current && current.contains?.(related)) return;
  formFieldDragOverId.value = '';
  formFieldDragOverPosition.value = 'before';
};

const handleFormFieldDrop = async (fieldId, event) => {
  if (!canCreateForms.value || !formFieldDragId.value) return;
  event?.preventDefault?.();
  const fromId = formFieldDragId.value;
  const position = formFieldDragOverPosition.value;
  clearFormFieldDrag();
  await reorderFormFields(fromId, fieldId, position);
};

const handleFormFieldDragEnd = () => {
  clearFormFieldDrag();
};

const handleOpenFormPage = () => {
  if (!activeForm.value) return;
  if (typeof openFormPage === 'function') {
    openFormPage(activeForm.value.id);
  }
};

const handleOpenFormFromList = (formId) => {
  if (!formId) return;
  if (typeof openFormPage === 'function') {
    openFormPage(formId);
  }
};

const cloneForSeed = (value) => JSON.parse(JSON.stringify(value));

const hydrateRow = (row) => ({
  ...row,
  data: row?.data && typeof row.data === 'object' ? { ...row.data } : {},
});

const isSelectField = (field) => field?.type === 'SELECT' || field?.type === 'MULTI_SELECT';
const normalizeFilterValues = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    return id ? [id] : [];
  }
  if (value === null || value === undefined) return [];
  const trimmed = String(value).trim();
  return trimmed ? [trimmed] : [];
};

const getComplianceRecordId = (row) => {
  const data = row?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const raw = data[COMPLIANCE_RECORD_KEY];
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  return trimmed || '';
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

const getAuditStatusClass = (status) => {
  if (typeof status !== 'string') return '';
  const normalized = status.trim().toUpperCase();
  return auditStatusClassById[normalized] || '';
};

const getAuditRowClass = (row) => {
  if (!isAuditView.value) return '';
  const tone = getAuditStatusClass(getRowComplianceStatus(row));
  return tone ? `db-row--audit db-row--audit-${tone}` : 'db-row--audit';
};


const stringifyValue = (value) => {
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (value instanceof Y.Map) {
    const label = value.get('label') ?? value.get('id');
    return label ? String(label) : '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    const label = value.label ?? value.id;
    if (label !== undefined && label !== null && String(label).trim()) {
      return String(label);
    }
  }
  if (value === null || value === undefined) return '';
  return String(value);
};

const relationOptionsForPage = (pageId) => relationOptionsByPageId.value[pageId] || [];
const relationFieldsForPage = (pageId) => relationFieldsByPageId.value[pageId] || [];
const relationRowsForPage = (pageId) => relationRowsByPageId.value[pageId] || [];
const relationOptionsLoadingForPage = (pageId) => relationOptionsLoading.value[pageId] === true;
const relationOptionsErrorForPage = (pageId) => relationOptionsError.value[pageId] || '';

const loadRelationOptions = async (pageId) => {
  if (!pageId) return;
  if (!hasApi.value || !activeUser.value) return;
  if (relationOptionsByPageId.value[pageId]) return;
  if (relationOptionsLoading.value[pageId]) return;
  relationOptionsLoading.value = { ...relationOptionsLoading.value, [pageId]: true };
  relationOptionsError.value = { ...relationOptionsError.value, [pageId]: '' };
  try {
    const res = await api.getDatabase(pageId, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
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
    const options = targetRows
      .map((row) => {
        const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
        const label = titleFieldId ? stringifyValue(data[titleFieldId]) : '';
        const fallback = label || (row?.id ? String(row.id) : '');
        return row?.id ? { id: row.id, label: fallback } : null;
      })
      .filter(Boolean);
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

const getRowIdValue = (row) => (row?.id ? String(row.id) : '');

const renderRowIdCell = (row) => {
  const value = getRowIdValue(row);
  return h('span', { class: 'db-readonly-cell db-row-id-cell', title: value }, value || '—');
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
  let changed = false;
  const updateRow = (row) => {
    if (rowPageId(row) !== pageId) return;
    const data = row?.data && typeof row.data === 'object' ? { ...row.data } : {};
    if (data[fieldId] === nextTitle) return;
    data[fieldId] = nextTitle;
    row.data = data;
    changed = true;
    if (isCollabEnabled.value) {
      const rowMap = ensureCollabRowMap(row.id);
      const dataMap = ensureCollabRowDataMap(rowMap);
      if (dataMap) {
        dataMap.set(fieldId, nextTitle);
      }
    }
  };
  if (isCollabEnabled.value) {
    const doc = ensureCollabDoc();
    doc.transact(() => {
      rows.value.forEach(updateRow);
    }, 'db-row-title-sync');
  } else {
    rows.value.forEach(updateRow);
  }
  if (changed) {
    scheduleSortRefresh();
  }
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
  const rowMap = ensureCollabRowMap(rowId);
  const dataMap = ensureCollabRowDataMap(rowMap);
  if (!rowMap || !dataMap) return;
  const doc = ensureCollabDoc();
  doc.transact(() => {
    Array.from(dataMap.keys()).forEach((key) => dataMap.delete(key));
    Object.entries(data).forEach(([key, value]) => {
      dataMap.set(key, value);
    });
  }, 'db-row-props');
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

const normalizeCellValue = (field, value) => {
  const rawValue = String(value ?? '');
  if (!field) return rawValue;
  if (field.type === 'MULTI_SELECT') {
    if (Array.isArray(value)) {
      const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
      return cleaned.length ? cleaned : null;
    }
    const raw = rawValue.trim();
    if (!raw) return null;
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const raw = rawValue;
  const trimmed = raw.trim();
  if (field.type === 'NUMBER') {
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  if (field.type === 'CHECKBOX') {
    if (!trimmed) return null;
    const normalized = trimmed.toLowerCase();
    if (['true', 'yes', '1', 'x', 'y'].includes(normalized)) return true;
    if (['false', 'no', '0'].includes(normalized)) return false;
    return true;
  }
  if (field.type === 'URL') {
    if (!trimmed) return null;
    return trimmed;
  }
  if (!trimmed) return null;
  return raw;
};

const normalizeRelationEntry = (raw) => {
  if (!raw) return null;
  if (raw instanceof Y.Map) {
    const id = raw.get('id');
    const label = raw.get('label');
    if (id) return { id: String(id), label: label ? String(label) : '' };
    return null;
  }
  if (typeof raw === 'string') {
    const id = raw.trim();
    return id ? { id, label: '' } : null;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id) return null;
    const label = typeof raw.label === 'string' ? raw.label.trim() : '';
    return { id, label };
  }
  return null;
};

const getRelationEntries = (row, field) => {
  if (!row || !field) return [];
  const raw = row?.data?.[field.id];
  if (!raw) return [];
  if (raw instanceof Y.Array) {
    return raw.toArray().map((entry) => normalizeRelationEntry(entry)).filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeRelationEntry(entry)).filter(Boolean);
  }
  const entry = normalizeRelationEntry(raw);
  return entry ? [entry] : [];
};

const getRelationLabel = (field, entry) => {
  if (!entry) return '';
  if (entry.label) return entry.label;
  const relation = getRelationConfig(field);
  if (relation?.pageId) {
    const match = relationOptionsForPage(relation.pageId).find((option) => option.id === entry.id);
    if (match?.label) return match.label;
  }
  return entry.id || '';
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

const shouldClearCell = (value) => value === null || value === '' || (Array.isArray(value) && value.length === 0);

const valueForField = (row, field) => {
  const value = row?.data?.[field.id];
  if (field.type === 'RELATION') {
    const entry = getRelationEntries(row, field)[0];
    return entry?.id || '';
  }
  if (field.type === 'MULTI_SELECT') {
    if (Array.isArray(value)) return value.join(', ');
    if (value instanceof Y.Array) return value.toArray().map((item) => String(item).trim()).filter(Boolean).join(', ');
  }
  return value ?? '';
};

const getAssetTagValue = (row, field) => {
  const raw = row?.data?.[field.id];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw !== null && raw !== undefined) return String(raw);
  return row?.id ? String(row.id) : '';
};

const getMultiSelectValues = (row, field) => {
  if (!row || !field) return [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation?.allowMultiple) return [];
    return getRelationEntries(row, field).map((entry) => entry.id).filter(Boolean);
  }
  const value = row?.data?.[field.id];
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => String(item).trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const getMultiSelectValuesFromRaw = (value) => {
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => String(item).trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const getMultiSelectChoiceValues = (options) => {
  const normalized = normalizeFieldOptions({ options });
  return normalized.choices.map((choice) => choice.value).filter(Boolean);
};

const pruneMultiSelectValues = (values, allowedSet) => values.filter((value) => allowedSet.has(value));

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
  if (field.type === 'SELECT') {
    return getChoiceLabel(field, valueForField(row, field));
  }
  return valueForField(row, field);
};

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const hex = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
};

const toPlainValue = (value) => {
  if (value instanceof Y.Map) {
    const obj = {};
    value.forEach((item, key) => {
      obj[key] = toPlainValue(item);
    });
    return obj;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => toPlainValue(item));
  }
  return value;
};

const getEntryValue = (entry, key) => {
  if (!entry) return undefined;
  if (entry instanceof Y.Map) return entry.get(key);
  return entry[key];
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
};

const clearYMap = (map) => {
  if (!map) return;
  map.forEach((_, key) => {
    map.delete(key);
  });
};

const createCollabDoc = () => {
  const guid = collabContext.value?.docName || `wikid-db-${Math.random().toString(16).slice(2)}`;
  return new Y.Doc({ guid });
};

const readCollabOrder = (order) => {
  if (!order) return [];
  const raw = typeof order.toArray === 'function' ? order.toArray() : [];
  return raw.map((id) => String(id)).filter(Boolean);
};

const buildFieldsFromCollab = () => {
  if (!collabFieldsMap.value) return [];
  const order = readCollabOrder(collabFieldOrder.value);
  const seen = new Set();
  const result = [];
  const pushField = (id) => {
    if (!id || seen.has(id)) return;
    const entry = collabFieldsMap.value.get(id);
    if (!entry) return;
    const name = String(getEntryValue(entry, 'name') ?? '');
    const type = String(getEntryValue(entry, 'type') || 'TEXT');
    const rawOptions = toPlainValue(getEntryValue(entry, 'options'));
    const options =
      rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions) ? rawOptions : {};
    result.push({ id, name, type, options: normalizeFieldOptions({ options }) });
    seen.add(id);
  };
  order.forEach((id) => pushField(id));
  collabFieldsMap.value.forEach((_, id) => {
    if (!seen.has(id)) pushField(String(id));
  });
  return result;
};

const buildRowsFromCollab = () => {
  if (!collabRowsMap.value) return [];
  const order = readCollabOrder(collabRowOrder.value);
  const seen = new Set();
  const result = [];
  const pushRow = (id) => {
    if (!id || seen.has(id)) return;
    const entry = collabRowsMap.value.get(id);
    if (!entry) return;
    const rawData = getEntryValue(entry, 'data');
    const rawPageId = getEntryValue(entry, 'pageId');
    let data = {};
    if (rawData instanceof Y.Map) {
      rawData.forEach((value, key) => {
        data[key] = toPlainValue(value);
      });
    } else {
      const plain = toPlainValue(rawData);
      if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
        data = { ...plain };
      }
    }
    const pageId = typeof rawPageId === 'string' ? rawPageId : null;
    result.push(hydrateRow({ id, data, pageId }));
    seen.add(id);
  };
  order.forEach((id) => pushRow(id));
  collabRowsMap.value.forEach((_, id) => {
    if (!seen.has(id)) pushRow(String(id));
  });
  return result;
};

const applyCollabState = () => {
  if (!collabFieldsMap.value || !collabRowsMap.value) return;
  if (isCollabDocEmpty() && !collabSeeded.value) return;
  const nextFields = buildFieldsFromCollab();
  const nextRows = buildRowsFromCollab();
  const statusByRowId = new Map(rows.value.map((row) => [row.id, row.complianceStatus]));
  nextRows.forEach((row) => {
    if (statusByRowId.has(row.id)) {
      row.complianceStatus = statusByRowId.get(row.id) ?? null;
    }
  });
  syncComplianceStatusCache(nextRows);
  fields.value = nextFields;

  // If a cell is focused, merge row data in-place to avoid destroying the
  // focused input element. Only replace rows.value when rows are added/removed.
  const active = document.activeElement;
  const focusInTable = active && tableWrapRef.value?.contains(active);
  if (focusInTable && rows.value.length === nextRows.length) {
    const existingById = new Map(rows.value.map((r) => [r.id, r]));
    let canMerge = nextRows.every((r) => existingById.has(r.id));
    if (canMerge) {
      nextRows.forEach((nextRow) => {
        const existing = existingById.get(nextRow.id);
        if (!existing) return;
        if (!existing.data || typeof existing.data !== 'object') existing.data = {};
        if (nextRow.data && typeof nextRow.data === 'object') {
          for (const [k, v] of Object.entries(nextRow.data)) {
            existing.data[k] = v;
          }
        }
        if (nextRow.pageId) existing.pageId = nextRow.pageId;
        if (nextRow.updatedAt) existing.updatedAt = nextRow.updatedAt;
        if (nextRow.complianceStatus !== undefined) existing.complianceStatus = nextRow.complianceStatus;
      });
    } else {
      rows.value = nextRows;
    }
  } else {
    rows.value = nextRows;
  }

  const fieldIds = new Set(nextFields.map((field) => field.id));
  fieldIds.add(ROW_ID_COLUMN_ID);
  sorting.value = sorting.value.filter((sort) => fieldIds.has(sort.id));
  columnSizing.value = Object.fromEntries(
    Object.entries(columnSizing.value).filter(([key]) => fieldIds.has(key))
  );
};

const scheduleCollabApply = () => {
  if (collabApplyScheduled.value) return;
  collabApplyScheduled.value = true;
  const apply = () => {
    collabApplyScheduled.value = false;
    applyCollabState();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(apply);
  } else {
    setTimeout(apply, 0);
  }
};

const isCollabDocEmpty = () => {
  const hasFields = collabFieldsMap.value && collabFieldsMap.value.size > 0;
  const hasRows = collabRowsMap.value && collabRowsMap.value.size > 0;
  const hasFieldOrder = collabFieldOrder.value && collabFieldOrder.value.length > 0;
  const hasRowOrder = collabRowOrder.value && collabRowOrder.value.length > 0;
  return !hasFields && !hasRows && !hasFieldOrder && !hasRowOrder;
};

const seedCollabFromSnapshot = (snapshot) => {
  if (!collabDoc.value || !snapshot) return;
  if (!collabFieldsMap.value || !collabRowsMap.value) return;
  if (!collabFieldOrder.value || !collabRowOrder.value) return;
  collabDoc.value.transact(() => {
    clearYMap(collabFieldsMap.value);
    clearYMap(collabRowsMap.value);
    if (collabFieldOrder.value.length) {
      collabFieldOrder.value.delete(0, collabFieldOrder.value.length);
    }
    if (collabRowOrder.value.length) {
      collabRowOrder.value.delete(0, collabRowOrder.value.length);
    }
    snapshot.fields.forEach((field) => {
      if (!field?.id) return;
      const fieldMap = new Y.Map();
      fieldMap.set('name', field.name || '');
      fieldMap.set('type', field.type || 'TEXT');
      fieldMap.set('options', normalizeFieldOptions(field));
      collabFieldsMap.value.set(field.id, fieldMap);
      collabFieldOrder.value.push([field.id]);
    });
    snapshot.rows.forEach((row) => {
      if (!row?.id) return;
      const rowMap = new Y.Map();
      const dataMap = new Y.Map();
      const data = row?.data && typeof row.data === 'object' ? row.data : {};
      Object.entries(data).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
      rowMap.set('data', dataMap);
      if (row?.pageId) {
        rowMap.set('pageId', row.pageId);
      }
      collabRowsMap.value.set(row.id, rowMap);
      collabRowOrder.value.push([row.id]);
    });
  }, 'db-seed');
};

const maybeSeedCollab = () => {
  if (!isCollabEnabled.value || !collabDoc.value) return;
  if (!collabSynced.value || collabSeeded.value) return;
  if (!lastLoadedSnapshot.value) return;
  if (isCollabDocEmpty()) {
    seedCollabFromSnapshot(lastLoadedSnapshot.value);
  }
  collabSeeded.value = true;
  scheduleCollabApply();
};

const syncCollabRowsFromSnapshot = (snapshot) => {
  if (!snapshot?.rows?.length) return;
  if (!isCollabEnabled.value || !collabDoc.value) return;
  if (!collabRowsMap.value || !collabRowOrder.value) return;
  const rowsMap = collabRowsMap.value;
  const rowOrder = collabRowOrder.value;
  const existingOrder = new Set(readCollabOrder(rowOrder));
  collabDoc.value.transact(() => {
    snapshot.rows.forEach((row) => {
      if (!row?.id) return;
      const existing = rowsMap.get(row.id);
      if (existing instanceof Y.Map) {
        if (row.pageId && !existing.get('pageId')) {
          existing.set('pageId', row.pageId);
        }
        if (!existingOrder.has(row.id)) {
          rowOrder.push([row.id]);
          existingOrder.add(row.id);
        }
        return;
      }
      const rowMap = new Y.Map();
      const dataMap = new Y.Map();
      const data = row?.data && typeof row.data === 'object' ? row.data : {};
      Object.entries(data).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
      rowMap.set('data', dataMap);
      if (row?.pageId) {
        rowMap.set('pageId', row.pageId);
      }
      rowsMap.set(row.id, rowMap);
      rowOrder.push([row.id]);
      existingOrder.add(row.id);
    });
  }, 'db-row-sync');
};

const syncCollabFieldsFromSnapshot = (snapshot) => {
  if (!snapshot?.fields?.length) return;
  if (!isCollabEnabled.value || !collabDoc.value) return;
  if (!collabFieldsMap.value || !collabFieldOrder.value) return;
  const fieldsMap = collabFieldsMap.value;
  const fieldOrder = collabFieldOrder.value;
  const existingOrder = new Set(readCollabOrder(fieldOrder));
  collabDoc.value.transact(() => {
    snapshot.fields.forEach((field) => {
      if (!field?.id) return;
      const existing = fieldsMap.get(field.id);
      if (existing instanceof Y.Map) {
        if (!existingOrder.has(field.id)) {
          fieldOrder.push([field.id]);
          existingOrder.add(field.id);
        }
        return;
      }
      const fieldMap = new Y.Map();
      fieldMap.set('name', field.name || '');
      fieldMap.set('type', field.type || 'TEXT');
      fieldMap.set('options', normalizeFieldOptions(field));
      fieldsMap.set(field.id, fieldMap);
      fieldOrder.push([field.id]);
      existingOrder.add(field.id);
    });
  }, 'db-field-sync');
};

const unbindCollabDoc = () => {
  if (collabObserver.value && collabFieldsMap.value) {
    collabFieldsMap.value.unobserveDeep(collabObserver.value);
  }
  if (collabObserver.value && collabRowsMap.value) {
    collabRowsMap.value.unobserveDeep(collabObserver.value);
  }
  if (collabObserver.value && collabFieldOrder.value) {
    collabFieldOrder.value.unobserve(collabObserver.value);
  }
  if (collabObserver.value && collabRowOrder.value) {
    collabRowOrder.value.unobserve(collabObserver.value);
  }
  collabObserver.value = null;
  collabFieldsMap.value = null;
  collabRowsMap.value = null;
  collabFieldOrder.value = null;
  collabRowOrder.value = null;
};

const bindCollabDoc = (doc) => {
  unbindCollabDoc();
  if (!doc) return;
  collabFieldsMap.value = doc.getMap('fields');
  collabRowsMap.value = doc.getMap('rows');
  collabFieldOrder.value = doc.getArray('fieldOrder');
  collabRowOrder.value = doc.getArray('rowOrder');
  const observer = (_, transaction) => {
    if (transaction?.origin === 'db-cell-update') return;
    scheduleCollabApply();
  };
  collabObserver.value = observer;
  collabFieldsMap.value.observeDeep(observer);
  collabRowsMap.value.observeDeep(observer);
  collabFieldOrder.value.observe(observer);
  collabRowOrder.value.observe(observer);
  scheduleCollabApply();
};

const handleCollabSynced = (synced) => {
  if (!synced) return;
  collabSynced.value = true;
  maybeSeedCollab();
  syncCollabFieldsFromSnapshot(lastLoadedSnapshot.value);
  syncCollabRowsFromSnapshot(lastLoadedSnapshot.value);
  scheduleCollabApply();
};

const teardownCollabProvider = (options = {}) => {
  if (collabProvider.value) {
    collabProvider.value.off?.('synced', handleCollabSynced);
    collabProvider.value.destroy();
  }
  collabProvider.value = null;
  if (!options.keepDoc) {
    unbindCollabDoc();
    collabDoc.value = null;
    currentCollabDocName.value = null;
    collabSynced.value = false;
    collabSeeded.value = false;
  }
};

const setupCollabProvider = () => {
  const ctx = collabContext.value;
  if (!ctx) {
    teardownCollabProvider();
    return;
  }
  const docName = ctx.docName;
  if (!collabDoc.value || currentCollabDocName.value !== docName) {
    teardownCollabProvider();
    collabDoc.value = createCollabDoc();
    bindCollabDoc(collabDoc.value);
    currentCollabDocName.value = docName;
    collabSynced.value = false;
    collabSeeded.value = false;
  }
  if (collabProvider.value && currentCollabDocName.value === docName) {
    return;
  }
  try {
    collabProvider.value = new HocuspocusProvider({
      url: ctx.url,
      name: ctx.docName,
      token: () => collabContext.value?.token,
      document: collabDoc.value,
    });
    collabProvider.value.on('synced', handleCollabSynced);
  } catch (err) {
    console.warn('Database collab provider failed to initialize', err);
    teardownCollabProvider({ keepDoc: true });
  }
};

const ensureCollabDoc = () => {
  if (collabDoc.value) return collabDoc.value;
  const doc = createCollabDoc();
  collabDoc.value = doc;
  bindCollabDoc(doc);
  currentCollabDocName.value = collabContext.value?.docName || null;
  collabSynced.value = false;
  collabSeeded.value = false;
  return doc;
};

const ensureCollabFieldMap = (fieldId) => {
  if (!fieldId) return null;
  const doc = ensureCollabDoc();
  const fieldsMap = collabFieldsMap.value || doc.getMap('fields');
  collabFieldsMap.value = fieldsMap;
  const entry = fieldsMap.get(fieldId);
  if (entry instanceof Y.Map) return entry;
  const fieldMap = new Y.Map();
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    Object.entries(entry).forEach(([key, value]) => {
      fieldMap.set(key, value);
    });
  }
  fieldsMap.set(fieldId, fieldMap);
  return fieldMap;
};

const ensureCollabRowMap = (rowId) => {
  if (!rowId) return null;
  const doc = ensureCollabDoc();
  const rowsMap = collabRowsMap.value || doc.getMap('rows');
  collabRowsMap.value = rowsMap;
  const entry = rowsMap.get(rowId);
  if (entry instanceof Y.Map) return entry;
  const rowMap = new Y.Map();
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    Object.entries(entry).forEach(([key, value]) => {
      rowMap.set(key, value);
    });
  }
  rowsMap.set(rowId, rowMap);
  return rowMap;
};

const ensureCollabRowDataMap = (rowMap) => {
  if (!rowMap) return null;
  const entry = rowMap.get('data');
  if (entry instanceof Y.Map) return entry;
  const dataMap = new Y.Map();
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    Object.entries(entry).forEach(([key, value]) => {
      dataMap.set(key, value);
    });
  }
  rowMap.set('data', dataMap);
  return dataMap;
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
        const rowMap = ensureCollabRowMap(rowId);
        const dataMap = ensureCollabRowDataMap(rowMap);
        if (dataMap && nextRow.data.__pageId) {
          dataMap.set('__pageId', nextRow.data.__pageId);
        }
      }
    }
    if (nextRow?.pageId) {
      row.pageId = nextRow.pageId;
      if (isCollabEnabled.value) {
        const rowMap = ensureCollabRowMap(rowId);
        const doc = ensureCollabDoc();
        if (rowMap && doc) {
          doc.transact(() => {
            rowMap.set('pageId', nextRow.pageId);
          }, 'db-row-page');
        }
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

const hexToRgb = (hex) => {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.trim().replace('#', '');
  if (![3, 6].includes(cleaned.length)) return null;
  const normalized = cleaned.length === 3 ? cleaned.split('').map((char) => char + char).join('') : cleaned;
  const num = Number.parseInt(normalized, 16);
  if (Number.isNaN(num)) return null;
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
};

const rgbaFromHex = (hex, alpha) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

const multiSelectPillStyle = (color) => {
  if (!color) return {};
  const background = rgbaFromHex(color, 0.18) || color;
  const border = rgbaFromHex(color, 0.45) || color;
  return { backgroundColor: background, borderColor: border };
};

const multiSelectDotStyle = (color) => ({
  backgroundColor: color || 'rgba(148, 163, 184, 0.35)',
  borderColor: color || 'rgba(148, 163, 184, 0.6)',
});

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
  return getMultiSelectValues(row, field);
});

const activeMultiSelectChoices = computed(() => {
  const field = activeMultiSelectField.value;
  if (!field) return [];
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation?.allowMultiple || !relation.pageId) return [];
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

const formFieldOptions = computed(() => {
  const used = new Set(activeForm.value?.fields.map((field) => field.fieldId) ?? []);
  return fields.value
    .filter((field) => field?.id && !used.has(field.id))
    .map((field) => ({
      id: field.id,
      name: field.name || 'Field',
      type: field.type,
    }));
});

const formFilterFieldOptions = computed(() => {
  const base = fields.value.map((field) => ({
    id: field.id,
    name: field.name || 'Field',
    type: field.type,
  }));
  if (!isComplianceDatabase.value) return base;
  return [governanceFilterOption, ...base];
});

const formFilterField = computed(() => {
  const fieldId = activeFormConfig.value?.filter?.fieldId;
  if (!fieldId || fieldId === GOVERNANCE_FILTER_ID) return null;
  return fieldById.value.get(fieldId) || null;
});

const isGovernanceFilter = computed(() => activeFormConfig.value?.filter?.fieldId === GOVERNANCE_FILTER_ID);

const formFilterValueSelection = computed(() => {
  const filter = activeFormConfig.value?.filter;
  if (!filter) return '';
  if (isGovernanceFilter.value) {
    const values = normalizeFilterValues(filter.value);
    return values[0] || '';
  }
  const field = formFilterField.value;
  if (field && (field.type === 'SELECT' || field.type === 'RELATION')) {
    const values = normalizeFilterValues(filter.value);
    return values[0] || '';
  }
  if (Array.isArray(filter.value)) {
    const first = filter.value.find((item) => typeof item === 'string' && item.trim());
    return first ? first.trim() : '';
  }
  if (filter.value === null || filter.value === undefined) return '';
  if (typeof filter.value === 'string') return filter.value;
  return String(filter.value);
});

const formFilterUsesChoices = computed(() => {
  if (isGovernanceFilter.value) return true;
  const field = formFilterField.value;
  return !!field && field.type === 'SELECT';
});

const formFilterRelation = computed(() => {
  if (isGovernanceFilter.value) return null;
  const field = formFilterField.value;
  if (!field || field.type !== 'RELATION') return null;
  return getRelationConfig(field);
});

const formFilterRelationOptionsBase = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return [];
  return relationOptionsForPage(relation.pageId);
});

const formFilterRelationLoading = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return false;
  return relationOptionsLoadingForPage(relation.pageId);
});

const formFilterRelationError = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return '';
  return relationOptionsErrorForPage(relation.pageId);
});

const formFilterRelationMissingValue = computed(() => {
  const relation = formFilterRelation.value;
  if (!relation?.pageId) return '';
  if (formFilterRelationLoading.value || formFilterRelationError.value) return '';
  const filter = activeFormConfig.value?.filter;
  if (!filter || (filter.op !== 'equals' && filter.op !== 'notEquals')) return '';
  const value = formFilterValueSelection.value;
  if (!value) return '';
  const allowed = new Set(formFilterRelationOptionsBase.value.map((option) => option.id));
  return allowed.has(value) ? '' : value;
});

const formFilterRelationOptions = computed(() => {
  const options = formFilterRelationOptionsBase.value;
  const missing = formFilterRelationMissingValue.value;
  if (!missing) return options;
  return [{ id: missing, label: `Missing: ${missing}` }, ...options];
});

const formFilterRelationPlaceholder = computed(() => {
  if (formFilterRelationError.value) return 'Failed to load';
  if (formFilterRelationLoading.value) return 'Loading...';
  return AUTO_SIZE_RELATION_PLACEHOLDER;
});

const formFilterMissingValues = computed(() => {
  const filter = activeFormConfig.value?.filter;
  const field = formFilterField.value;
  if (!filter) return [];
  if (filter.op !== 'equals' && filter.op !== 'notEquals') return [];
  const values = normalizeFilterValues(filter.value);
  if (!values.length) return [];
  if (isGovernanceFilter.value) {
    const allowed = new Set(governanceFilterChoices.map((choice) => choice.value));
    return values.filter((value) => !allowed.has(value));
  }
  if (!field || field.type !== 'SELECT') return [];
  const allowed = new Set(normalizeFieldOptions(field).choices.map((choice) => choice.value));
  return values.filter((value) => !allowed.has(value));
});

const formFilterChoiceOptions = computed(() => {
  if (isGovernanceFilter.value) {
    const missing = formFilterMissingValues.value;
    if (!missing.length) return governanceFilterChoices;
    const extra = missing.map((value) => ({ value, label: `Missing: ${value}` }));
    return [...extra, ...governanceFilterChoices];
  }
  const field = formFilterField.value;
  if (!field || field.type !== 'SELECT') return [];
  const choices = normalizeFieldOptions(field).choices;
  const missing = formFilterMissingValues.value;
  if (!missing.length) return choices;
  const extra = missing.map((value) => ({ value, label: `Missing: ${value}` }));
  return [...extra, ...choices];
});

const formFilterWarning = computed(() => {
  const field = formFilterField.value;
  if (isGovernanceFilter.value) {
    const missing = formFilterMissingValues.value;
    if (!missing.length) return '';
    if (missing.length === 1) {
      return `Filter value "${missing[0]}" is no longer a governance status.`;
    }
    const values = missing.map((value) => `"${value}"`).join(', ');
    return `Filter values ${values} are no longer governance statuses.`;
  }
  if (!field) return '';
  if (field.type === 'SELECT') {
    const missing = formFilterMissingValues.value;
    if (!missing.length) return '';
    const label = field?.name || 'Field';
    if (missing.length === 1) {
      return `Filter value "${missing[0]}" is no longer an option for ${label}.`;
    }
    const values = missing.map((value) => `"${value}"`).join(', ');
    return `Filter values ${values} are no longer options for ${label}.`;
  }
  if (field.type === 'RELATION') {
    if (formFilterRelationError.value) {
      return `Relation options failed to load: ${formFilterRelationError.value}`;
    }
    const missing = formFilterRelationMissingValue.value;
    if (!missing) return '';
    const label = field?.name || 'Field';
    return `Filter value "${missing}" is no longer a related record for ${label}.`;
  }
  return '';
});

const formConditionFieldOptions = computed(() => {
  const form = activeForm.value;
  if (!form) return [];
  const inForm = new Set(form.fields.map((entry) => entry.fieldId));
  return fields.value
    .filter((field) => inForm.has(field.id))
    .map((field) => ({
      id: field.id,
      name: field.name || 'Field',
      type: field.type,
    }));
});

const formSelectSourceRelations = computed(() =>
  fields.value
    .filter((field) => field?.type === 'RELATION')
    .map((field) => {
      const relation = getRelationConfig(field);
      if (!relation?.pageId) return null;
      return {
        id: field.id,
        name: field.name || 'Field',
        pageId: relation.pageId,
      };
    })
    .filter(Boolean)
);

const hasFormSelectSourceRelations = computed(() => formSelectSourceRelations.value.length > 0);

const formFilterNeedsValue = computed(() => {
  const op = activeFormConfig.value?.filter?.op;
  return op === 'equals' || op === 'notEquals';
});

const resolvedActiveFormFields = computed(() => {
  const form = activeForm.value;
  if (!form) return [];
  return form.fields.map((entry) => {
    const field = fieldById.value.get(entry.fieldId);
    const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
    const name = rawLabel || field?.name || 'Field';
    const auto = entry?.auto && typeof entry.auto === 'object' && !Array.isArray(entry.auto) ? entry.auto : null;
    const source = field ? getFieldSource(field) : null;
    const autoType = typeof auto?.type === 'string' ? auto.type : '';
    const autoTemplate = autoType === 'template' && typeof auto?.template === 'string' ? auto.template : '';
    const autoMode =
      autoType === 'currentUser' && typeof auto?.mode === 'string'
        ? auto.mode
        : source === 'members'
        ? 'id'
        : 'name';
    const selectSource =
      entry?.selectSource && typeof entry.selectSource === 'object' && !Array.isArray(entry.selectSource)
        ? entry.selectSource
        : null;
    const selectSourceType = selectSource?.type === 'relation' ? 'relation' : 'manual';
    const selectSourceRelationFieldId =
      typeof selectSource?.relationFieldId === 'string' ? selectSource.relationFieldId : '';
    const selectSourceTargetFieldId =
      typeof selectSource?.targetFieldId === 'string' ? selectSource.targetFieldId : '';
    const selectSourceRelationField = selectSourceRelationFieldId ? fieldById.value.get(selectSourceRelationFieldId) : null;
    const selectSourceRelationConfig = selectSourceRelationField ? getRelationConfig(selectSourceRelationField) : null;
    const selectSourcePageId = selectSourceRelationConfig?.pageId || '';
    const selectSourceTargetOptions = selectSourcePageId ? relationFieldsForPage(selectSourcePageId) : [];
    const selectSourceLoading = selectSourcePageId ? relationOptionsLoadingForPage(selectSourcePageId) : false;
    const selectSourceError = selectSourcePageId ? relationOptionsErrorForPage(selectSourcePageId) : '';
    const autoFixedChoices = getAutoFixedChoices(entry.fieldId, selectSource);
    const autoFixedValue =
      autoType === 'fixed' && typeof auto?.value === 'string' ? auto.value.trim() : '';
    const autoFixedMissing =
      autoType === 'fixed' &&
      autoFixedValue &&
      autoFixedChoices.length > 0 &&
      !autoFixedChoices.some((choice) => choice.value === autoFixedValue);
    const relationConfig = field?.type === 'RELATION' ? getRelationConfig(field) : null;
    const relationPageId = relationConfig?.pageId || '';
    const autoFixedLoading =
      field?.type === 'RELATION'
        ? relationPageId
          ? relationOptionsLoadingForPage(relationPageId)
          : false
        : selectSourceType === 'relation'
        ? selectSourceLoading
        : false;
    const autoFixedError =
      field?.type === 'RELATION'
        ? relationPageId
          ? relationOptionsErrorForPage(relationPageId)
          : ''
        : selectSourceType === 'relation'
        ? selectSourceError
        : '';
    const autoFixedPlaceholder = autoFixedError
      ? 'Failed to load'
      : autoFixedLoading
      ? 'Loading...'
      : 'Select value';
    const autoFixedHint =
      autoType === 'fixed'
        ? autoFixedError
          ? `Relation options failed to load: ${autoFixedError}`
          : autoFixedLoading
          ? 'Loading relation options...'
          : autoFixedChoices.length === 0
          ? 'No related values available.'
          : autoFixedMissing
          ? 'Fixed value is no longer an option.'
          : ''
        : '';
    const selectSourceTargetMissing =
      selectSourceTargetFieldId &&
      !selectSourceLoading &&
      !selectSourceError &&
      !selectSourceTargetOptions.some((option) => option.id === selectSourceTargetFieldId);
    const selectSourcePlaceholder = selectSourceError
      ? 'Failed to load'
      : selectSourceLoading
      ? 'Loading...'
      : 'Select field...';
    const selectSourceWarning =
      selectSourceType !== 'relation'
        ? ''
        : !hasFormSelectSourceRelations.value
        ? 'No relation tables available.'
        : !selectSourceRelationFieldId
        ? 'Select a relation field.'
        : !selectSourceRelationField
        ? 'Relation field is missing.'
        : !selectSourcePageId
        ? 'Relation target is not configured.'
        : selectSourceError
        ? `Relation options failed to load: ${selectSourceError}`
        : selectSourceTargetMissing
        ? 'Related field is missing.'
        : '';
    const requiredWhen =
      entry?.requiredWhen && typeof entry.requiredWhen === 'object' && !Array.isArray(entry.requiredWhen)
        ? entry.requiredWhen
        : null;
    const requiredWhenFieldId = typeof requiredWhen?.fieldId === 'string' ? requiredWhen.fieldId : '';
    const requiredWhenValue = typeof requiredWhen?.value === 'string' ? requiredWhen.value : '';
    const requiredWhenOp = normalizeRequiredWhenOp(requiredWhen?.op);
    const requiredWhenField = requiredWhenFieldId ? fieldById.value.get(requiredWhenFieldId) : null;
    const requiredWhenFieldType = requiredWhenField?.type || null;
    const requiredWhenChoices =
      requiredWhenField && requiredWhenField.type === 'SELECT' ? normalizeFieldOptions(requiredWhenField).choices : [];
    const visibleWhen =
      entry?.visibleWhen && typeof entry.visibleWhen === 'object' && !Array.isArray(entry.visibleWhen)
        ? entry.visibleWhen
        : null;
    const visibleWhenFieldId = typeof visibleWhen?.fieldId === 'string' ? visibleWhen.fieldId : '';
    const visibleWhenValue = typeof visibleWhen?.value === 'string' ? visibleWhen.value : '';
    const visibleWhenOp = normalizeRequiredWhenOp(visibleWhen?.op);
    const visibleWhenField = visibleWhenFieldId ? fieldById.value.get(visibleWhenFieldId) : null;
    const visibleWhenFieldType = visibleWhenField?.type || null;
    const visibleWhenChoices =
      visibleWhenField && visibleWhenField.type === 'SELECT' ? normalizeFieldOptions(visibleWhenField).choices : [];
    return {
      id: entry.fieldId,
      name,
      type: field?.type || null,
      locked: field ? isFieldReadOnly(field) : false,
      missing: !field,
      required: !!entry.required,
      editable: entry?.editable !== false,
      auto,
      autoType,
      autoTemplate,
      autoMode,
      autoFixedValue,
      autoFixedChoices,
      autoFixedMissing,
      autoFixedPlaceholder,
      autoFixedHint,
      selectSourceType,
      selectSourceRelationFieldId,
      selectSourceTargetFieldId,
      selectSourceTargetOptions,
      selectSourcePlaceholder,
      selectSourceWarning,
      requiredWhen,
      requiredWhenFieldId,
      requiredWhenValue,
      requiredWhenOp,
      requiredWhenFieldType,
      requiredWhenChoices,
      visibleWhen,
      visibleWhenFieldId,
      visibleWhenValue,
      visibleWhenOp,
      visibleWhenFieldType,
      visibleWhenChoices,
    };
  });
});

const ruleBlocks = computed(() => resolvedActiveFormFields.value.filter((field) => field.requiredWhenFieldId));

const availableRuleTargets = computed(() =>
  resolvedActiveFormFields.value.filter((field) => !field.requiredWhenFieldId && !field.missing && !field.locked)
);

const visibilityBlocks = computed(() => resolvedActiveFormFields.value.filter((field) => field.visibleWhenFieldId));

const availableVisibilityTargets = computed(() =>
  resolvedActiveFormFields.value.filter((field) => !field.visibleWhenFieldId && !field.missing && !field.locked)
);

const clearFormFieldRequiredWhen = async (fieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.requiredWhen) return entry;
    const nextEntry = { ...entry };
    delete nextEntry.requiredWhen;
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const clearFormFieldVisibleWhen = async (fieldId) => {
  if (!canCreateForms.value) return;
  const form = activeForm.value;
  if (!form || !fieldId) return;
  const nextFields = form.fields.map((entry) => {
    if (entry.fieldId !== fieldId) return entry;
    if (!entry?.visibleWhen) return entry;
    const nextEntry = { ...entry };
    delete nextEntry.visibleWhen;
    return nextEntry;
  });
  await saveFormFields(form.id, nextFields);
};

const addRequiredWhenRule = async () => {
  if (!canCreateForms.value) return;
  const targetFieldId = typeof newRuleTargetFieldId.value === 'string' ? newRuleTargetFieldId.value.trim() : '';
  const conditionFieldId =
    typeof newRuleConditionFieldId.value === 'string' ? newRuleConditionFieldId.value.trim() : '';
  if (!targetFieldId || !conditionFieldId) return;
  await updateFormFieldRequiredWhenField(targetFieldId, conditionFieldId);
  newRuleTargetFieldId.value = '';
  newRuleConditionFieldId.value = '';
};

const addVisibleWhenRule = async () => {
  if (!canCreateForms.value) return;
  const targetFieldId =
    typeof newVisibilityTargetFieldId.value === 'string' ? newVisibilityTargetFieldId.value.trim() : '';
  const conditionFieldId =
    typeof newVisibilityConditionFieldId.value === 'string' ? newVisibilityConditionFieldId.value.trim() : '';
  if (!targetFieldId || !conditionFieldId) return;
  await updateFormFieldVisibleWhenField(targetFieldId, conditionFieldId);
  newVisibilityTargetFieldId.value = '';
  newVisibilityConditionFieldId.value = '';
};

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

watch(
  () => formFilterRelation.value?.pageId || '',
  (pageId) => {
    if (!pageId) return;
    void loadRelationOptions(pageId);
  }
);

watch(
  () => activeViewId.value,
  () => {
    formFieldSelectId.value = '';
  }
);

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
    const rowMap = ensureCollabRowMap(rowId);
    const dataMap = ensureCollabRowDataMap(rowMap);
    if (!rowMap || !dataMap) return;
    const doc = ensureCollabDoc();
    doc.transact(() => {
      if (clearing) {
        dataMap.delete(fieldId);
      } else {
        dataMap.set(fieldId, value);
      }
    }, 'db-cell-update');
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

const updateAwarenessUser = () => {
  const awareness = collabProvider.value?.awareness;
  if (!awareness) return;
  awareness.setLocalStateField('user', presenceUser.value);
};

const setLocalCellCursor = (rowId, fieldId, mode = 'focus', offset = null, value = null, caretLeft = null) => {
  const awareness = collabProvider.value?.awareness;
  if (!awareness) return;
  if (!rowId || !fieldId) {
    lastLocalCursor = null;
    awareness.setLocalStateField('dbCursor', null);
    return;
  }
  lastLocalCursor = {
    rowId,
    fieldId,
    offset: Number.isFinite(offset) ? offset : null,
    value: typeof value === 'string' ? value : null,
    caretLeft: Number.isFinite(caretLeft) ? caretLeft : null,
  };
  awareness.setLocalStateField('dbCursor', {
    rowId,
    fieldId,
    mode,
    offset: Number.isFinite(offset) ? offset : null,
    value: typeof value === 'string' ? value : null,
    caretLeft: Number.isFinite(caretLeft) ? caretLeft : null,
    ts: Date.now(),
  });
};

const clearLocalCellCursor = () => {
  if (localTypingTimer) {
    clearTimeout(localTypingTimer);
    localTypingTimer = null;
  }
  setLocalCellCursor(null, null);
};

const readSelectionOffset = (target) => {
  const offset = target?.selectionStart;
  if (Number.isFinite(offset)) return offset;
  const value = target?.value;
  if (typeof value === 'string') return value.length;
  return null;
};

const caretLeftFromTarget = (target) => {
  if (typeof window === 'undefined' || !target) return null;
  const offset = readSelectionOffset(target);
  if (!Number.isFinite(offset)) return null;
  const value = String(target.value ?? '');
  const head = value.slice(0, Math.max(0, offset));
  const font = getFontForElement(target);
  const width = measureTextWidth(head, font);
  const style = window.getComputedStyle(target);
  const paddingLeft = parseFloat(style.paddingLeft || '0') || 0;
  const borderLeft = parseFloat(style.borderLeftWidth || '0') || 0;
  const scrollLeft = target.scrollLeft || 0;
  const raw = width + paddingLeft + borderLeft + 4 - scrollLeft;
  const max = Math.max(6, target.clientWidth - 6);
  return Math.min(Math.max(raw, 6), max);
};

const markCellFocus = (rowId, fieldId, target) => {
  if (!isCollabEnabled.value) return;
  if (localTypingTimer) {
    clearTimeout(localTypingTimer);
    localTypingTimer = null;
  }
  setLocalCellCursor(
    rowId,
    fieldId,
    'focus',
    readSelectionOffset(target),
    target?.value ?? null,
    caretLeftFromTarget(target)
  );
};

const markCellTyping = (rowId, fieldId, target) => {
  if (!isCollabEnabled.value) return;
  setLocalCellCursor(
    rowId,
    fieldId,
    'typing',
    readSelectionOffset(target),
    target?.value ?? null,
    caretLeftFromTarget(target)
  );
  if (localTypingTimer) {
    clearTimeout(localTypingTimer);
  }
  localTypingTimer = setTimeout(() => {
    localTypingTimer = null;
    const cursor = lastLocalCursor;
    if (cursor && cursor.rowId === rowId && cursor.fieldId === fieldId) {
      setLocalCellCursor(
        cursor.rowId,
        cursor.fieldId,
        'focus',
        cursor.offset,
        cursor.value,
        cursor.caretLeft
      );
    } else {
      setLocalCellCursor(rowId, fieldId, 'focus');
    }
  }, 1200);
};

const markCellBlur = () => {
  if (!isCollabEnabled.value) return;
  clearLocalCellCursor();
};

const onTableFocusOut = () => {
  // When focus leaves the table entirely, run any deferred sort refresh
  // and flush pending ensureRowPage calls.
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!active || !tableWrapRef.value?.contains(active)) {
      flushPendingEnsureRowPages();
      scheduleSortRefresh();
    }
  });
};

const handleCaretNavigate = (rowId, fieldId, event) => {
  const key = event?.key;
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (key && !keys.includes(key)) return;
  markCellFocus(rowId, fieldId, event?.target);
};

const handleCaretMouse = (rowId, fieldId, event) => {
  markCellFocus(rowId, fieldId, event?.target);
};

const updateCellPresence = () => {
  const awareness = collabProvider.value?.awareness;
  if (!awareness) {
    collabCellPresence.value = [];
    emit('collabpresence', []);
    return;
  }
  const states = Array.from(awareness.getStates().values());
  const topbarEntries = [];
  const cellEntries = [];
  const seen = new Set();
  states.forEach((state) => {
    const user = state?.user;
    if (!user) return;
    const id = user.id || user.name || 'guest';
    if (!seen.has(id)) {
      const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : 'Guest';
      const color = typeof user.color === 'string' && user.color ? user.color : '#3b82f6';
      const letter = name.charAt(0).toUpperCase();
      topbarEntries.push({ id, name, color, letter });
      seen.add(id);
    }
    const cursor = state?.dbCursor;
    if (!cursor?.rowId || !cursor?.fieldId) return;
    if (localPresenceId.value && id === localPresenceId.value) return;
    const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : 'Guest';
    const color = typeof user.color === 'string' && user.color ? user.color : '#3b82f6';
    cellEntries.push({
      id,
      name,
      color,
      rowId: String(cursor.rowId),
      fieldId: String(cursor.fieldId),
      mode: cursor.mode === 'typing' ? 'typing' : 'focus',
      offset: Number.isFinite(cursor.offset) ? cursor.offset : null,
      value: typeof cursor.value === 'string' ? cursor.value : null,
      caretLeft: Number.isFinite(cursor.caretLeft) ? cursor.caretLeft : null,
      ts: typeof cursor.ts === 'number' ? cursor.ts : 0,
    });
  });
  collabCellPresence.value = cellEntries;
  emit('collabpresence', topbarEntries);
};

const attachAwarenessListener = () => {
  const awareness = collabProvider.value?.awareness || null;
  if (collabAwarenessSource.value && collabAwarenessHandler.value) {
    collabAwarenessSource.value.off('update', collabAwarenessHandler.value);
  }
  collabAwarenessHandler.value = null;
  collabAwarenessSource.value = awareness;
  if (awareness) {
    const handler = () => updateCellPresence();
    awareness.on('update', handler);
    collabAwarenessHandler.value = handler;
    updateCellPresence();
  } else {
    collabCellPresence.value = [];
    emit('collabpresence', []);
  }
};

const setCellInputRef = (rowId, fieldId) => (el) => {
  const key = `${rowId}:${fieldId}`;
  if (!el) {
    cellInputRefs.delete(key);
    return;
  }
  cellInputRefs.set(key, el);
};

const getMeasureContext = () => {
  if (typeof document === 'undefined') return null;
  if (!caretMeasureCanvas) {
    caretMeasureCanvas = document.createElement('canvas');
  }
  return caretMeasureCanvas.getContext('2d');
};

const getFontForElement = (el) => {
  if (typeof window === 'undefined' || !el) return null;
  const style = window.getComputedStyle(el);
  if (style.font) return style.font;
  return `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
};

const measureTextWidth = (text, font) => {
  const ctx = getMeasureContext();
  if (!ctx || !font) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
};

const caretLeftForCell = (rowId, fieldId, offset, textValue) => {
  if (typeof window === 'undefined') return 6;
  if (!Number.isFinite(offset)) return 6;
  const el = cellInputRefs.get(`${rowId}:${fieldId}`);
  if (!el) return 6;
  const value = typeof textValue === 'string' ? textValue : String(textValue ?? '');
  const head = value.slice(0, Math.max(0, offset));
  const font = getFontForElement(el);
  const width = measureTextWidth(head, font);
  const style = window.getComputedStyle(el);
  const paddingLeft = parseFloat(style.paddingLeft || '0') || 0;
  const borderLeft = parseFloat(style.borderLeftWidth || '0') || 0;
  const scrollLeft = el.scrollLeft || 0;
  const raw = width + paddingLeft + borderLeft + 4 - scrollLeft;
  const max = Math.max(6, el.clientWidth - 6);
  return Math.min(Math.max(raw, 6), max);
};

const cellPresenceMap = computed(() => {
  const map = new Map();
  collabCellPresence.value.forEach((entry) => {
    const key = `${entry.rowId}:${entry.fieldId}`;
    const list = map.get(key) || [];
    list.push(entry);
    map.set(key, list);
  });
  return map;
});

const getCellPresence = (rowId, fieldId) =>
  cellPresenceMap.value.get(`${rowId}:${fieldId}`) || [];

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
  addFieldName.value = '';
};

const closeMultiSelectMenu = () => {
  multiSelectMenu.value = { open: false, fieldId: null, rowId: null, x: 0, y: 0 };
};

const closeRowMenu = () => {
  rowMenu.value = { open: false, rowId: null, x: 0, y: 0 };
};

const closeColumnsMenu = () => {
  columnsMenu.value = { open: false, x: 0, y: 0 };
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
  const isRelationMulti = field.type === 'RELATION' && relation?.allowMultiple === true;
  if (field.type !== 'MULTI_SELECT' && !isRelationMulti) return;
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
  if (isRelationMulti && relation?.pageId) {
    void loadRelationOptions(relation.pageId);
  }
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

const sanitizeNumberInput = (value) => {
  if (value === null || value === undefined) return '';
  let raw = String(value);
  raw = raw.replace(/[^0-9.-]/g, '');
  const hasLeadingMinus = raw.startsWith('-');
  raw = raw.replace(/-/g, '');
  if (hasLeadingMinus) {
    raw = `-${raw}`;
  }
  const dotIndex = raw.indexOf('.');
  if (dotIndex !== -1) {
    raw = `${raw.slice(0, dotIndex + 1)}${raw.slice(dotIndex + 1).replace(/\./g, '')}`;
  }
  return raw;
};

const isNumberInputCandidateValid = (value) => /^-?\d*\.?\d*$/.test(value);

const handleNumberKeydown = (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End', 'Escape'];
  if (allowedKeys.includes(event.key)) return;
  if (event.key.length !== 1) return;
  const target = event.target;
  const current = String(target?.value ?? '');
  const start = target?.selectionStart ?? current.length;
  const end = target?.selectionEnd ?? start;
  const next = `${current.slice(0, start)}${event.key}${current.slice(end)}`;
  if (!isNumberInputCandidateValid(next)) {
    event.preventDefault();
  }
};

const handleCellConfirmKeydown = (event) => {
  if (event?.key !== 'Enter') return;
  if (event.isComposing || event.key === 'Process') return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.target;
  if (typeof target?.blur === 'function') {
    target.blur();
  }
};

const handleNumberPaste = (event) => {
  const text = event.clipboardData?.getData('text') ?? '';
  if (!text) return;
  const cleaned = sanitizeNumberInput(text);
  if (cleaned === text) return;
  event.preventDefault();
  const target = event.target;
  const current = String(target?.value ?? '');
  const start = target?.selectionStart ?? current.length;
  const end = target?.selectionEnd ?? start;
  const next = `${current.slice(0, start)}${cleaned}${current.slice(end)}`;
  target.value = next;
  if (typeof target?.setSelectionRange === 'function') {
    const pos = start + cleaned.length;
    target.setSelectionRange(pos, pos);
  }
};

const compareNullable = (a, b, compare) => {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  return compare(a, b);
};

const sortByType = (type, aRaw, bRaw) => {
  if (type === 'NUMBER') {
    const aNum = aRaw === null || aRaw === undefined || aRaw === '' ? null : Number(aRaw);
    const bNum = bRaw === null || bRaw === undefined || bRaw === '' ? null : Number(bRaw);
    return compareNullable(aNum, bNum, (a, b) => a - b);
  }
  if (type === 'DATE') {
    const aTime = aRaw ? new Date(aRaw).getTime() : null;
    const bTime = bRaw ? new Date(bRaw).getTime() : null;
    return compareNullable(aTime, bTime, (a, b) => a - b);
  }
  if (type === 'CHECKBOX') {
    const aBool = aRaw ? 1 : 0;
    const bBool = bRaw ? 1 : 0;
    return compareNullable(aBool, bBool, (a, b) => a - b);
  }
  const aText = stringifyValue(aRaw).toLowerCase();
  const bText = stringifyValue(bRaw).toLowerCase();
  return compareNullable(aText, bText, (a, b) => a.localeCompare(b));
};

const renderMultiSelectCell = (row, field) => {
  const values = getMultiSelectValues(row, field);
  const placeholder =
    field.type === 'RELATION'
      ? AUTO_SIZE_RELATION_MULTI_PLACEHOLDER
      : isMembersField(field)
      ? AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER
      : AUTO_SIZE_MULTI_PLACEHOLDER;
  const pills = values.length
    ? values.map((value) =>
        h(
          'span',
          {
            key: value,
            class: 'db-multi-pill',
            style: multiSelectPillStyle(choiceColorForValue(field, value)),
          },
          getChoiceLabel(field, value)
        )
      )
    : [h('span', { class: 'db-multi-placeholder' }, placeholder)];
  return h(
    'button',
    {
      class: 'db-multi-cell',
      type: 'button',
      disabled: isReadonly.value || isFieldReadOnly(field),
      onFocus: (event) => markCellFocus(row.id, field.id, event.target),
      onBlur: () => markCellBlur(),
      onClick: (event) => openMultiSelectMenu(row, field, event),
    },
    pills
  );
};

const renderCellInput = (row, field) => {
  const presence = getCellPresence(row.id, field.id);
  const typing = presence.find((entry) => entry.mode === 'typing');
  const primary = typing || presence[0] || null;
  const cellValue = valueForField(row, field);
  const targetPresence = typing || primary;
  const targetValue = targetPresence?.value ?? cellValue;
  const measuredLeft =
    targetPresence && Number.isFinite(targetPresence.offset)
      ? caretLeftForCell(row.id, field.id, targetPresence.offset, targetValue)
      : null;
  const caretLeft =
    Number.isFinite(measuredLeft)
      ? measuredLeft
      : targetPresence && Number.isFinite(targetPresence.caretLeft)
        ? targetPresence.caretLeft
        : null;
  const isReadOnlyCell = isFieldReadOnly(field);
  const cellDisabled = isReadonly.value || isReadOnlyCell;
  const presenceWrap = (node) =>
    h(
      'div',
      {
        class: [
          'db-cell',
          presence.length ? 'db-cell--presence' : '',
          typing ? 'db-cell--typing' : '',
          isReadOnlyCell ? 'db-cell--readonly' : '',
        ],
        style: primary
          ? {
              '--presence-color': primary.color,
              '--presence-caret-left': caretLeft ? `${caretLeft}px` : undefined,
            }
          : {},
      },
      [
        presence.length
          ? h('div', { class: 'db-cell-presence' })
          : null,
        node,
      ]
    );
  if (isAssetTagField(field)) {
    const value = getAssetTagValue(row, field);
    return presenceWrap(
      h(
        'button',
        {
          class: 'db-qr-btn',
          type: 'button',
          disabled: !value,
          title: value || '',
          'aria-label': 'View asset tag QR',
          onClick: (event) => {
            event?.stopPropagation?.();
            openAssetTagPreview(value);
          },
        },
        [h('i', { class: 'bi bi-qr-code', 'aria-hidden': 'true' })]
      )
    );
  }
  if (isPageField(field)) {
    const pageId = rowPageId(row);
    const rawTitle = valueForField(row, field);
    // For the read-only branch we need the full title; for the editable branch
    // we defer pageMap reads to event handlers. getTitle() is called lazily.
    const getTitle = () => getRowPageTitle(row, field) || 'Untitled page';
    const openRowPage = (pageOrId) => {
      if (typeof openRowPageOverlay === 'function') {
        openRowPageOverlay(pageOrId);
        return;
      }
      if (typeof pageOrId === 'string') {
        const stored = pageMap.value.get(pageOrId) || null;
        if (stored) {
          workspace.selectPage(stored, { allowHidden: true });
          return;
        }
        if (workspace.hasApi) {
          workspace.loadPageDoc(pageOrId);
        }
        return;
      }
      if (pageOrId) {
        workspace.selectPage(pageOrId, { allowHidden: true });
      }
    };
    const handleOpen = async () => {
      const page = resolveRowPage(row);
      if (page || pageId) {
        openRowPage(page || pageId);
        return;
      }
      if (isReadonly.value) return;
      const targetPage = await ensureRowPage(row, { title: getTitle() });
      if (targetPage) {
        openRowPage(targetPage);
      }
    };
    if (!isPageFieldEditable(field)) {
      const page = resolveRowPage(row);
      const title = getTitle();
      const allowMissingOpen = !isReadonly.value;
      return presenceWrap(
        h('div', { class: ['db-page-link', page ? '' : 'db-page-link--missing'] }, [
          h(
            'div',
            {
              class: 'db-page-link__main',
            },
            [
              h(PageIcon, { class: 'db-page-link__icon', icon: page?.icon, fallback: '📄', 'aria-hidden': 'true' }),
              h('span', { class: 'db-page-link__title' }, title),
            ]
          ),
          h(
            'button',
            {
              class: 'db-page-link__action',
              type: 'button',
              disabled: !page && !allowMissingOpen,
              onClick: handleOpen,
            },
            'Open'
          ),
        ])
      );
    }
    // Editable page field: avoid reading pageMap / workspace.pages here.
    // Any reactive read causes Vue to re-render this cell when pages change,
    // which destroys the focused <input> and drops focus. Page lookups are
    // deferred to event handlers (handleOpen) which run outside the render.
    return presenceWrap(
      h('div', { class: 'db-page-input' }, [
        h(
          'button',
          {
            class: 'db-page-input__open',
            type: 'button',
            disabled: !pageId && (isReadonly.value || isFieldReadOnly(field)),
            onClick: handleOpen,
          },
          [h(PageIcon, { class: 'db-page-input__icon', icon: row.icon ?? null, fallback: '📄', 'aria-hidden': 'true' })]
        ),
        h('input', {
          class: 'db-cell-input db-page-input__field',
          type: 'text',
          value: rawTitle,
          disabled: cellDisabled,
          onKeydown: handleCellConfirmKeydown,
          onFocus: (event) => markCellFocus(row.id, field.id, event.target),
          onBlur: (event) => {
            markCellBlur();
            const nextTitle = event?.target?.value;
            const pageId = rowPageId(row);
            // Defer all side effects so the browser settles focus before we
            // trigger any reactive re-renders.
            requestAnimationFrame(() => requestAnimationFrame(() => {
              if (pageId) {
                applyLocalPageTitleUpdate(pageId, nextTitle ?? '');
                schedulePageTitleUpdate(pageId, nextTitle ?? '');
              }
              // Defer ensureRowPage while focus is in the table — its API
              // response calls workspace.upsertPage() which triggers a
              // re-render that destroys the newly focused input.
              if (pageId || (typeof nextTitle === 'string' && nextTitle.trim())) {
                const active = document.activeElement;
                const focusInTable = active && tableWrapRef.value?.contains(active);
                if (focusInTable) {
                  pendingEnsureRowPages.push({ row, options: { title: nextTitle } });
                } else {
                  ensureRowPage(row, { title: nextTitle });
                }
              }
              scheduleSortRefresh();
            }));
          },
          onKeyup: (event) => handleCaretNavigate(row.id, field.id, event),
          onMouseup: (event) => handleCaretMouse(row.id, field.id, event),
          onInput: (event) => {
            markCellTyping(row.id, field.id, event.target);
            updateCell(row, field, event.target.value, { deferSort: true });
          },
          ref: setCellInputRef(row.id, field.id),
        }),
        h(
          'button',
          {
            class: 'db-page-link__action',
            type: 'button',
            disabled: isReadonly.value || isFieldReadOnly(field),
            onClick: handleOpen,
          },
          'Open'
        ),
      ])
    );
  }
  if (isLastEditedField(field)) {
    const label = formatDateTime(resolveRowLastEdited(row));
    return presenceWrap(h('span', { class: 'db-readonly-cell' }, label || '—'));
  }
  if (field.type === 'CHECKBOX') {
    return presenceWrap(
      h('input', {
      class: 'db-cell-input',
      type: 'checkbox',
      checked: !!row.data?.[field.id],
      disabled: cellDisabled,
      onFocus: (event) => markCellFocus(row.id, field.id, event.target),
      onBlur: () => markCellBlur(),
      onChange: (event) => updateCell(row, field, event.target.checked),
    })
    );
  }
  if (field.type === 'DATE') {
    return presenceWrap(
      h('input', {
        class: 'db-cell-input',
        type: 'date',
        value: valueForField(row, field),
        disabled: cellDisabled,
        onKeydown: handleCellConfirmKeydown,
        onFocus: (event) => markCellFocus(row.id, field.id, event.target),
        onBlur: () => markCellBlur(),
        onChange: (event) => updateCell(row, field, event.target.value),
        ref: setCellInputRef(row.id, field.id),
      })
    );
  }
  if (field.type === 'NUMBER') {
    return presenceWrap(
      h('input', {
        class: 'db-cell-input',
        type: 'text',
      inputmode: 'decimal',
      pattern: '^-?\\d*\\.?\\d*$',
        step: 'any',
        value: valueForField(row, field),
        disabled: cellDisabled,
        onKeydown: (event) => {
          handleNumberKeydown(event);
          handleCellConfirmKeydown(event);
        },
        onKeyup: (event) => handleCaretNavigate(row.id, field.id, event),
        onMouseup: (event) => handleCaretMouse(row.id, field.id, event),
        onPaste: handleNumberPaste,
        onFocus: (event) => markCellFocus(row.id, field.id, event.target),
        onInput: (event) => {
          const cleaned = sanitizeNumberInput(event.target.value);
          if (event.target.value !== cleaned) {
            event.target.value = cleaned;
          }
          markCellTyping(row.id, field.id, event.target);
          updateCell(row, field, cleaned, { raw: true, deferSort: true });
        },
        onBlur: (event) => {
          const cleaned = sanitizeNumberInput(event.target.value);
          if (event.target.value !== cleaned) {
            event.target.value = cleaned;
            updateCell(row, field, cleaned, { deferSort: true });
          }
          markCellBlur();
          scheduleSortRefresh();
        },
        ref: setCellInputRef(row.id, field.id),
      })
    );
  }
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (relation?.allowMultiple) {
      if (relation.pageId && !relationOptionsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
        void loadRelationOptions(relation.pageId);
      }
      return presenceWrap(renderMultiSelectCell(row, field));
    }
    if (relation?.pageId) {
      if (!relationOptionsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
        void loadRelationOptions(relation.pageId);
      }
    }
    const options = relation?.pageId ? relationOptionsForPage(relation.pageId) : [];
    const loading = relation?.pageId ? relationOptionsLoadingForPage(relation.pageId) : false;
    const loadError = relation?.pageId ? relationOptionsErrorForPage(relation.pageId) : '';
    const placeholder = loadError ? 'Failed to load' : loading ? 'Loading...' : AUTO_SIZE_RELATION_PLACEHOLDER;
    return presenceWrap(
      h(
        'select',
        {
          class: 'db-cell-input',
          value: valueForField(row, field),
          disabled: cellDisabled || !relation?.pageId,
          onFocus: (event) => markCellFocus(row.id, field.id, event.target),
          onBlur: () => markCellBlur(),
          onChange: (event) => updateCell(row, field, event.target.value),
          ref: setCellInputRef(row.id, field.id),
        },
        [
          h('option', { value: '' }, placeholder),
          ...options.map((option) => h('option', { key: option.id, value: option.id }, option.label || option.id)),
        ]
      )
    );
  }
  if (field.type === 'SELECT') {
    const choices = getFieldChoices(field);
    return presenceWrap(
      h(
        'select',
        {
          class: 'db-cell-input',
          value: valueForField(row, field),
          disabled: cellDisabled,
          onFocus: (event) => markCellFocus(row.id, field.id, event.target),
          onBlur: () => markCellBlur(),
          onChange: (event) => updateCell(row, field, event.target.value),
          ref: setCellInputRef(row.id, field.id),
        },
        [
          h('option', { value: '' }, AUTO_SIZE_SELECT_PLACEHOLDER),
          ...choices.map((option) => h('option', { key: option.value, value: option.value }, option.label || option.value)),
        ]
      )
    );
  }
  if (field.type === 'MULTI_SELECT') {
    return presenceWrap(renderMultiSelectCell(row, field));
  }
  return presenceWrap(
    h('input', {
      class: 'db-cell-input db-cell-input--text',
      type: field.type === 'URL' ? 'url' : 'text',
      value: valueForField(row, field),
      disabled: cellDisabled,
      onKeydown: handleCellConfirmKeydown,
      onKeyup: (event) => handleCaretNavigate(row.id, field.id, event),
      onMouseup: (event) => handleCaretMouse(row.id, field.id, event),
      onFocus: (event) => markCellFocus(row.id, field.id, event.target),
      onInput: (event) => {
        markCellTyping(row.id, field.id, event.target);
        updateCell(row, field, event.target.value, { deferSort: true });
      },
      onBlur: () => {
        markCellBlur();
        scheduleSortRefresh();
      },
      ref: setCellInputRef(row.id, field.id),
    })
  );
};

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

// Parse a value into a comparable timestamp for DATE filters.
const toComparableDate = (value) => {
  if (value == null || value === '') return null;
  const ts = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
};

const matchesFilterRule = (row, rule) => {
  const field = fieldById.value.get(rule.fieldId);
  if (!field) return true;
  const { operator } = rule;
  const display = displayValueForField(row, field);
  const isEmpty =
    display == null || display === '' || (Array.isArray(display) && display.length === 0);
  if (operator === 'is_empty') return isEmpty;
  if (operator === 'is_not_empty') return !isEmpty;

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

  if (field.type === 'MULTI_SELECT' || field.type === 'RELATION') {
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

const choiceColorForValue = (field, value) => {
  if (!field || !value) return null;
  if (isMembersField(field)) {
    return colorFromId(value);
  }
  const choices = getFieldChoices(field);
  const match = choices.find((choice) => choice.value === value);
  return match?.color || null;
};

const isMultiSelectOptionSelected = (value) => activeMultiSelectValues.value.includes(value);

const toggleMultiSelectOption = (value) => {
  if (isReadonly.value) return;
  const row = activeMultiSelectRow.value;
  const field = activeMultiSelectField.value;
  if (!row || !field || !value) return;
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

// ---------------------------------------------------------------------------
// Saved views (persisted, filterable Table / Gallery / Board views)
// ---------------------------------------------------------------------------
const VIEW_TYPES = ['TABLE', 'GALLERY', 'BOARD'];
const VIEW_TYPE_LABELS = { TABLE: 'Table', GALLERY: 'Gallery', BOARD: 'Board' };
const DEFAULT_VIEW_ICONS = { TABLE: 'icon:table', GALLERY: 'icon:grid-3x3-gap', BOARD: 'icon:kanban' };
const OPERATOR_LABELS = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  before: 'before',
  after: 'after',
  on_or_before: 'on or before',
  on_or_after: 'on or after',
  is_checked: 'is checked',
  is_unchecked: 'is unchecked',
};

const operatorsForFieldType = (type) => {
  switch (type) {
    case 'CHECKBOX':
      return ['is_checked', 'is_unchecked'];
    case 'NUMBER':
      return ['is', 'is_not', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'];
    case 'DATE':
      return ['is', 'is_not', 'before', 'after', 'on_or_before', 'on_or_after', 'is_empty', 'is_not_empty'];
    case 'SELECT':
      return ['is', 'is_not', 'is_empty', 'is_not_empty'];
    case 'MULTI_SELECT':
    case 'RELATION':
      return ['contains', 'not_contains', 'is_empty', 'is_not_empty'];
    default:
      return ['is', 'is_not', 'contains', 'not_contains', 'is_empty', 'is_not_empty'];
  }
};
const operatorNeedsValue = (operator) =>
  !['is_empty', 'is_not_empty', 'is_checked', 'is_unchecked'].includes(operator);

const normalizeViewType = (value) => {
  const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return VIEW_TYPES.includes(upper) ? upper : 'TABLE';
};

const normalizeViewConfig = (config) => {
  const src = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const rawFilters = src.filters && typeof src.filters === 'object' ? src.filters : {};
  const rules = Array.isArray(rawFilters.rules)
    ? rawFilters.rules
        .filter((rule) => rule && typeof rule === 'object' && rule.fieldId && rule.operator)
        .map((rule) => ({
          fieldId: String(rule.fieldId),
          operator: String(rule.operator),
          value: rule.value === undefined ? null : rule.value,
        }))
    : [];
  const sorts = Array.isArray(src.sorts)
    ? src.sorts
        .filter((sort) => sort && typeof sort === 'object' && sort.fieldId)
        .map((sort) => ({ fieldId: String(sort.fieldId), direction: sort.direction === 'desc' ? 'desc' : 'asc' }))
    : [];
  const hiddenFieldIds = Array.isArray(src.hiddenFieldIds)
    ? src.hiddenFieldIds.filter((id) => typeof id === 'string')
    : [];
  return {
    filters: { match: rawFilters.match === 'OR' ? 'OR' : 'AND', rules },
    sorts,
    hiddenFieldIds,
    groupFieldId: typeof src.groupFieldId === 'string' ? src.groupFieldId : null,
    cardFieldId: typeof src.cardFieldId === 'string' ? src.cardFieldId : null,
  };
};

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
const scheduleViewPersist = (viewId, payload) => {
  if (!hasApi.value || !activeUser.value) return;
  const existing = viewSaveTimers.get(viewId);
  const started = existing?.started || workspace.beginSaving();
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    viewSaveTimers.delete(viewId);
    try {
      const res = await api.updateDatabaseView(viewId, payload, {
        userId: activeUser.value.id,
        userName: activeUser.value.name,
      });
      const normalized = normalizeSavedView(res);
      if (normalized) {
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

// --- Gallery / Board derived data ---
const boardGroupField = computed(() => {
  const id = activeSavedView.value?.config?.groupFieldId;
  return id ? fieldById.value.get(id) || null : null;
});
const boardColumns = computed(() => {
  if (!isBoardView.value) return [];
  const field = boardGroupField.value;
  const rowsForBoard = viewFilteredRows.value;
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
// Fields shown as card body lines in Gallery / Board (respecting hidden + card cover).
const cardBodyFields = computed(() =>
  fields.value.filter((field) => !hiddenFieldIdSet.value.has(field.id) && field.id !== galleryCardField.value?.id)
);
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
    formFieldSelectId.value = '';
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
    formFieldSelectId.value = '';
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

watch(
  () => activeForm.value?.id || '',
  () => {
    formBuilderTab.value = 'fields';
    newRuleTargetFieldId.value = '';
    newRuleConditionFieldId.value = '';
    newVisibilityTargetFieldId.value = '';
    newVisibilityConditionFieldId.value = '';
  },
  { immediate: true }
);

const createFieldWithType = async (type) => {
  if (isReadonly.value) return;
  if (!type) return;
  const trimmed = addFieldName.value.trim();
  const name = trimmed || addFieldPlaceholder.value;
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
  if (isCollabEnabled.value) {
    const doc = ensureCollabDoc();
    const fieldsMap = collabFieldsMap.value || doc.getMap('fields');
    const fieldOrder = collabFieldOrder.value || doc.getArray('fieldOrder');
    const id = generateId();
    const fieldMap = new Y.Map();
    fieldMap.set('name', name);
    fieldMap.set('type', type);
    if (type === 'SELECT' || type === 'MULTI_SELECT') {
      fieldMap.set('options', normalizeFieldOptions({ options }));
    } else if (type === 'RELATION') {
      fieldMap.set('options', { ...options });
    } else {
      fieldMap.set('options', {});
    }
    doc.transact(() => {
      fieldsMap.set(id, fieldMap);
      fieldOrder.push([id]);
    }, 'db-field-add');
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
    const fieldMap = ensureCollabFieldMap(field?.id);
    if (!fieldMap) return;
    const doc = ensureCollabDoc();
    let nextOptions = null;
    if ('options' in nextChanges) {
      const rawOptions =
        nextChanges.options && typeof nextChanges.options === 'object' && !Array.isArray(nextChanges.options)
          ? nextChanges.options
          : {};
      const shouldNormalize = nextType === 'SELECT' || nextType === 'MULTI_SELECT';
      nextOptions = shouldNormalize ? normalizeFieldOptions({ options: rawOptions }) : rawOptions;
    }
    doc.transact(() => {
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
    } catch (err) {
      console.warn('Create row failed', err);
      error.value = err?.message || 'Failed to create row';
    }
    return;
  }
  if (isCollabEnabled.value) {
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

onMounted(() => {
  document.addEventListener('mousedown', handleFieldMenuOutside);
  document.addEventListener('mousedown', handleRowMenuOutside);
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
  document.removeEventListener('mousedown', handleFieldMenuOutside);
  document.removeEventListener('mousedown', handleRowMenuOutside);
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
          <button
            v-for="view in savedViews"
            :key="view.id"
            class="db-view-tab"
            :class="{ 'db-view-tab--active': activeViewId === view.id }"
            type="button"
            :title="view.name"
            :aria-current="activeViewId === view.id ? 'page' : null"
            @click="activeViewId = view.id"
            @dblclick="renameSavedView(view)"
          >
            <PageIcon class="db-view-tab__icon" :icon="view.icon" fallback="Vw" aria-hidden="true" />
            <span class="db-view-tab__label">{{ view.name }}</span>
          </button>
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
        <button
          v-for="view in savedViews"
          :key="view.id"
          class="db-view-tab"
          :class="{ 'db-view-tab--active': activeViewId === view.id }"
          type="button"
          :title="view.name"
          :aria-current="activeViewId === view.id ? 'page' : null"
          @click="activeViewId = view.id"
          @dblclick="renameSavedView(view)"
        >
          <PageIcon class="db-view-tab__icon" :icon="view.icon" fallback="Vw" aria-hidden="true" />
          <span class="db-view-tab__label">{{ view.name }}</span>
        </button>
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
                }"
                :aria-sort="
                  header.column.getIsSorted() === 'asc'
                    ? 'ascending'
                    : header.column.getIsSorted() === 'desc'
                      ? 'descending'
                      : 'none'
                "
                :style="{ width: `${header.getSize()}px` }"
              >
                <div class="db-header-cell" :class="{ 'db-header-cell--add': header.column.id === ADD_COLUMN_ID }">
                  <input
                    v-if="headerIndex === 0 && selectedRowIds.size && !readonly"
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
                      :disabled="readonly"
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
                      :disabled="readonly"
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
                <button class="db-add-row-btn" type="button" :disabled="readonly" @click="addRow">
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
          </div>
          <div v-if="!viewFilteredRows.length" class="database-table__empty muted">No matching rows.</div>
          <div v-else class="db-gallery__grid">
            <button
              v-for="row in viewFilteredRows"
              :key="row.id"
              type="button"
              class="db-gallery__card"
              @click="openRowCard(row)"
            >
              <div class="db-gallery__title">{{ rowTitle(row) }}</div>
              <div
                v-if="galleryCardField"
                class="db-gallery__cover"
              >{{ galleryCardValue(row, galleryCardField) }}</div>
              <div class="db-gallery__fields">
                <div v-for="field in cardBodyFields" :key="field.id" class="db-gallery__field">
                  <span class="db-gallery__field-name">{{ field.name }}</span>
                  <span class="db-gallery__field-value">{{ galleryCardValue(row, field) }}</span>
                </div>
              </div>
            </button>
          </div>
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
        <div v-if="!activeForm" class="db-form-empty muted">Form not found.</div>
        <template v-else>
          <div class="db-form-builder__header">
            <div class="db-form-builder__heading">
              <PageIcon
                class="db-form-builder__icon"
                :icon="activeForm.icon || DEFAULT_FORM_ICON"
                fallback="Fm"
                aria-hidden="true"
              />
              <div>
                <div class="db-form-builder__title">{{ activeForm.name }}</div>
                <div class="db-form-builder__meta">{{ activeForm.fields.length }} fields</div>
              </div>
            </div>
            <div class="db-form-builder__actions">
              <button
                v-if="!embedded && openFormPage"
                class="db-form-open-btn"
                type="button"
                @click="handleOpenFormPage"
              >
                Open form
              </button>
              <button
                v-if="canCreateForms"
                class="db-form-delete-btn"
                type="button"
                @click="deleteFormView(activeForm)"
              >
                Delete
              </button>
            </div>
          </div>
          <div class="db-form-builder__section">
            <div class="db-form-builder__section-title">Behavior</div>
            <div class="db-form-builder__row">
              <label class="db-form-builder__label">Mode</label>
              <select
                class="db-form-builder__select"
                :value="activeFormConfig.mode"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormMode($event.target.value)"
              >
                <option value="create">Create new records</option>
                <option value="update">Update existing records</option>
              </select>
            </div>
            <div
              v-if="isComplianceDatabase && activeFormConfig.mode === 'create'"
              class="db-form-builder__row"
            >
              <label class="db-form-builder__label">Initial status</label>
              <select
                class="db-form-builder__select"
                :value="activeFormConfig.initialStatus"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormInitialStatus($event.target.value)"
              >
                <option v-for="status in auditStatusOptions" :key="status.id" :value="status.id">
                  {{ status.label }}
                </option>
              </select>
            </div>
            <div v-if="activeFormConfig.mode === 'update'" class="db-form-builder__row">
              <label class="db-form-builder__label">Filter field</label>
              <select
                class="db-form-builder__select"
                :value="activeFormConfig.filter?.fieldId || ''"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormFilterField($event.target.value)"
              >
                <option value="">Select field...</option>
                <option v-for="option in formFilterFieldOptions" :key="option.id" :value="option.id">
                  {{ option.name }} ({{ formatFieldType(option.type) }})
                </option>
              </select>
            </div>
            <div v-if="activeFormConfig.mode === 'update' && activeFormConfig.filter" class="db-form-builder__row">
              <label class="db-form-builder__label">Condition</label>
              <select
                class="db-form-builder__select"
                :value="activeFormConfig.filter?.op || 'isEmpty'"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormFilterOp($event.target.value)"
              >
                <option value="isEmpty">Is empty</option>
                <option value="isNotEmpty">Is not empty</option>
                <option value="equals">Equals</option>
                <option value="notEquals">Does not equal</option>
              </select>
            </div>
            <div
              v-if="activeFormConfig.mode === 'update' && activeFormConfig.filter && formFilterNeedsValue"
              class="db-form-builder__row"
            >
              <label class="db-form-builder__label">Filter value</label>
              <select
                v-if="formFilterUsesChoices"
                class="db-form-builder__select"
                :value="formFilterValueSelection"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormFilterValue($event.target.value)"
              >
                <option value="">Select value...</option>
                <option v-for="choice in formFilterChoiceOptions" :key="choice.value" :value="choice.value">
                  {{ choice.label || choice.value }}
                </option>
              </select>
              <select
                v-else-if="formFilterRelation"
                class="db-form-builder__select"
                :value="formFilterValueSelection"
                :disabled="!canCreateForms || isReadonly || !formFilterRelation?.pageId"
                @change="updateFormFilterValue($event.target.value)"
              >
                <option value="">{{ formFilterRelationPlaceholder }}</option>
                <option v-for="option in formFilterRelationOptions" :key="option.id" :value="option.id">
                  {{ option.label || option.id }}
                </option>
              </select>
              <input
                v-else
                class="db-form-builder__input"
                type="text"
                :value="activeFormConfig.filter?.value ?? ''"
                :disabled="!canCreateForms || isReadonly"
                placeholder="Value"
                @change="updateFormFilterValue($event.target.value)"
              />
            </div>
            <div v-if="activeFormConfig.mode === 'update' && formFilterWarning" class="db-form-builder__warning">
              {{ formFilterWarning }}
            </div>
            <div
              v-if="isComplianceDatabase && activeFormConfig.mode === 'update'"
              class="db-form-builder__row"
            >
              <label class="db-form-builder__label">Transition status</label>
              <select
                class="db-form-builder__select"
                :value="activeFormConfig.transitionStatus || ''"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormTransitionStatus($event.target.value)"
              >
                <option value="">No change</option>
                <option v-for="status in auditStatusOptions" :key="status.id" :value="status.id">
                  {{ status.label }}
                </option>
              </select>
            </div>
            <div class="db-form-builder__row">
              <label class="db-form-builder__label">Success message</label>
              <textarea
                class="db-form-builder__textarea"
                :value="activeFormConfig.successMessage"
                :disabled="!canCreateForms || isReadonly"
                placeholder="Thanks! Your response has been saved."
                @change="updateFormSuccessMessage($event.target.value)"
              ></textarea>
            </div>
            <label
              v-if="activeFormConfig.mode === 'update'"
              class="db-form-builder__toggle"
            >
              <input
                type="checkbox"
                :checked="activeFormConfig.showReturnButton"
                :disabled="!canCreateForms || isReadonly"
                @change="updateFormShowReturnButton($event.target.checked)"
              />
              Show “Back to list” button
            </label>
          </div>
          <div class="db-form-tabs">
            <button
              v-for="tab in formBuilderTabs"
              :key="tab.id"
              class="db-form-tab"
              :class="{ 'db-form-tab--active': formBuilderTab === tab.id }"
              type="button"
              @click="formBuilderTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>
          <template v-if="formBuilderTab === 'fields'">
            <div class="db-form-fields">
              <div v-if="!activeForm.fields.length" class="db-form-empty muted">
                No fields yet. Add one from the database columns.
              </div>
              <div
                v-for="field in resolvedActiveFormFields"
                :key="field.id"
                class="db-form-field"
                :class="{
                  'db-form-field--drag-over': formFieldDragOverId === field.id,
                  'db-form-field--drop-before': formFieldDragOverId === field.id && formFieldDragOverPosition === 'before',
                  'db-form-field--drop-after': formFieldDragOverId === field.id && formFieldDragOverPosition === 'after',
                  'db-form-field--dragging': formFieldDragId === field.id,
                }"
                @dragover="handleFormFieldDragOver(field.id, $event)"
                @dragenter="handleFormFieldDragOver(field.id, $event)"
                @dragleave="handleFormFieldDragLeave(field.id, $event)"
                @drop="handleFormFieldDrop(field.id, $event)"
              >
                <div class="db-form-field__handle">
                  <button
                    class="db-form-field-handle drag-handle__btn drag-handle__btn--drag"
                    type="button"
                    :disabled="!canCreateForms"
                    :draggable="canCreateForms"
                    aria-label="Reorder field"
                    @dragstart="handleFormFieldDragStart(field.id, $event)"
                    @dragend="handleFormFieldDragEnd"
                  >
                    <PageIcon class="db-form-field-handle__icon" icon="icon:three-dots-vertical" fallback="···" aria-hidden="true" />
                    <PageIcon class="db-form-field-handle__icon" icon="icon:three-dots-vertical" fallback="···" aria-hidden="true" />
                  </button>
                </div>
                <div class="db-form-field__header">
                  <div class="db-form-field__title">
                    <div class="db-form-field-name">{{ field.name }}</div>
                    <div class="db-form-field-meta">
                      {{ field.missing ? 'Missing field' : formatFieldType(field.type) }}
                    </div>
                  </div>
                  <span v-if="field.locked" class="db-form-field-lock">Locked</span>
                </div>
                <div class="db-form-field-controls">
                  <label class="db-form-field-toggle">
                    <input
                      class="db-form-field-checkbox"
                      type="checkbox"
                      :checked="field.required"
                      :disabled="field.missing || field.locked || isReadonly"
                      @change="updateFormFieldRequired(field.id, $event.target.checked)"
                    />
                    Required
                  </label>
                  <label class="db-form-field-toggle">
                    <input
                      class="db-form-field-checkbox"
                      type="checkbox"
                      :checked="field.editable"
                      :disabled="field.missing || field.locked || isReadonly"
                      @change="updateFormFieldEditable(field.id, $event.target.checked)"
                    />
                    Editable
                  </label>
                </div>
                <div class="db-form-field-controls">
                  <label class="db-form-field-label">Required when</label>
                  <select
                    class="db-form-field-select"
                    :value="field.requiredWhenFieldId"
                    :disabled="field.missing || field.locked || isReadonly || !formConditionFieldOptions.length"
                    @change="updateFormFieldRequiredWhenField(field.id, $event.target.value)"
                  >
                    <option value="">No condition</option>
                    <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                      {{ option.name }}
                    </option>
                  </select>
                </div>
                <div v-if="field.requiredWhenFieldId" class="db-form-field-controls">
                  <label class="db-form-field-label">Condition</label>
                  <select
                    class="db-form-field-select"
                    :value="field.requiredWhenOp"
                    :disabled="field.missing || field.locked || isReadonly"
                    @change="updateFormFieldRequiredWhenOp(field.id, $event.target.value)"
                  >
                    <option
                      v-for="option in getConditionOpOptions(field.requiredWhenFieldType, field.requiredWhenChoices.length)"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </div>
                <div v-if="field.requiredWhenFieldId && field.requiredWhenOp === 'equals'" class="db-form-field-controls">
                  <label class="db-form-field-label">Condition value</label>
                  <select
                    class="db-form-field-select"
                    :value="field.requiredWhenValue"
                    :disabled="field.missing || field.locked || isReadonly"
                    @change="updateFormFieldRequiredWhenValue(field.id, $event.target.value)"
                  >
                    <option value="">Select value</option>
                    <option v-for="choice in field.requiredWhenChoices" :key="choice.value" :value="choice.value">
                      {{ choice.label || choice.value }}
                    </option>
                  </select>
                </div>
                <div v-if="field.type === 'SELECT'" class="db-form-field-controls">
                  <label class="db-form-field-label">Options source</label>
                  <select
                    class="db-form-field-select"
                    :value="field.selectSourceType"
                    :disabled="field.missing || field.locked || isReadonly"
                    @change="updateFormFieldSelectSourceType(field.id, $event.target.value)"
                  >
                    <option value="manual">Manual options</option>
                    <option value="relation" :disabled="!hasFormSelectSourceRelations">Relation table</option>
                  </select>
                </div>
                <div v-if="field.type === 'SELECT' && field.selectSourceType === 'relation'" class="db-form-field-controls">
                  <label class="db-form-field-label">Relation field</label>
                  <select
                    class="db-form-field-select"
                    :value="field.selectSourceRelationFieldId"
                    :disabled="field.missing || field.locked || isReadonly || !hasFormSelectSourceRelations"
                    @change="updateFormFieldSelectSourceRelation(field.id, $event.target.value)"
                  >
                    <option value="">Select relation...</option>
                    <option v-for="option in formSelectSourceRelations" :key="option.id" :value="option.id">
                      {{ option.name }}
                    </option>
                  </select>
                </div>
                <div v-if="field.type === 'SELECT' && field.selectSourceType === 'relation'" class="db-form-field-controls">
                  <label class="db-form-field-label">Related field</label>
                  <select
                    class="db-form-field-select"
                    :value="field.selectSourceTargetFieldId"
                    :disabled="field.missing || field.locked || isReadonly || !field.selectSourceRelationFieldId"
                    @change="updateFormFieldSelectSourceTarget(field.id, $event.target.value)"
                  >
                    <option value="">{{ field.selectSourcePlaceholder }}</option>
                    <option v-for="option in field.selectSourceTargetOptions" :key="option.id" :value="option.id">
                      {{ option.name }} ({{ formatFieldType(option.type) }})
                    </option>
                  </select>
                </div>
                <div
                  v-if="field.type === 'SELECT' && field.selectSourceType === 'relation' && field.selectSourceWarning"
                  class="db-form-field-hint"
                >
                  {{ field.selectSourceWarning }}
                </div>
                <div class="db-form-field-controls">
                  <label class="db-form-field-label">Autofill</label>
                  <select
                    class="db-form-field-select"
                    :value="field.autoType"
                    :disabled="field.missing || field.locked || isReadonly"
                    @change="updateFormFieldAutoType(field.id, $event.target.value)"
                  >
                    <option value="">None</option>
                    <option value="currentUser">Current user</option>
                    <option value="template">Template</option>
                    <option
                      value="fixed"
                      :disabled="(field.type !== 'SELECT' && field.type !== 'RELATION') || !field.autoFixedChoices.length"
                    >
                      Fixed value
                    </option>
                  </select>
                </div>
                <div v-if="field.autoType === 'fixed'" class="db-form-field-controls">
                  <label class="db-form-field-label">Fixed value</label>
                  <select
                    class="db-form-field-select"
                    :value="field.autoFixedValue"
                    :disabled="
                      field.missing ||
                      field.locked ||
                      isReadonly ||
                      !field.autoFixedChoices.length
                    "
                    @change="updateFormFieldAutoFixedValue(field.id, $event.target.value)"
                  >
                    <option value="">{{ field.autoFixedPlaceholder }}</option>
                    <option v-for="choice in field.autoFixedChoices" :key="choice.value" :value="choice.value">
                      {{ choice.label || choice.value }}
                    </option>
                  </select>
                </div>
                <div v-if="field.autoType === 'fixed' && field.autoFixedHint" class="db-form-field-hint">
                  {{ field.autoFixedHint }}
                </div>
                <div v-if="field.autoType === 'currentUser'" class="db-form-field-controls">
                  <label class="db-form-field-label">User value</label>
                  <select
                    class="db-form-field-select"
                    :value="field.autoMode"
                    :disabled="field.missing || field.locked || isReadonly"
                    @change="updateFormFieldAutoMode(field.id, $event.target.value)"
                  >
                    <option value="name">Name</option>
                    <option value="id">User ID</option>
                  </select>
                </div>
                <div v-if="field.autoType === 'template'" class="db-form-field-controls">
                  <label class="db-form-field-label">Template</label>
                  <input
                    class="db-form-field-input"
                    type="text"
                    :value="field.autoTemplate"
                    :disabled="field.missing || field.locked || isReadonly"
                    placeholder="Incident Report #{{counter}}"
                    @change="updateFormFieldAutoTemplate(field.id, $event.target.value)"
                  />
                  <div class="db-form-field-hint" v-pre>Use {{counter}}, {{user}}, {{userId}}, {{date}}, {{datetime}}</div>
                </div>
              </div>
            </div>
            <div class="db-form-add">
              <select
                v-model="formFieldSelectId"
                class="db-form-select"
                :disabled="!formFieldOptions.length"
              >
                <option value="">Add field...</option>
                <option v-for="option in formFieldOptions" :key="option.id" :value="option.id">
                  {{ option.name }} ({{ formatFieldType(option.type) }})
                </option>
              </select>
              <button class="db-form-add-btn" type="button" :disabled="!formFieldSelectId" @click="addFieldToActiveForm">
                Add
              </button>
            </div>
          </template>
          <div v-else-if="formBuilderTab === 'rules'" class="db-form-rules">
            <div class="db-form-rules__header">
              <div>
                <div class="db-form-rules__title">Rules</div>
                <div class="db-form-rules__meta muted">Set required fields, autofill values, and conditional rules.</div>
              </div>
            </div>
            <div v-if="!resolvedActiveFormFields.length" class="db-form-empty muted">
              Add fields to build rules.
            </div>
            <div v-else class="db-form-rules__content">
              <div class="db-form-rules__section">
                <div class="db-form-rules__section-title">Required fields</div>
                <div class="db-form-rules__required-grid">
                  <label
                    v-for="field in resolvedActiveFormFields"
                    :key="field.id"
                    class="db-form-rules__required-item"
                    :class="{ 'db-form-rules__required-item--disabled': field.missing || field.locked }"
                  >
                    <input
                      class="db-form-field-checkbox"
                      type="checkbox"
                      :checked="field.required"
                      :disabled="field.missing || field.locked || isReadonly"
                      @change="updateFormFieldRequired(field.id, $event.target.checked)"
                    />
                    <span class="db-form-rules__required-name">{{ field.name }}</span>
                    <span class="db-form-rules__required-meta">
                      {{ field.missing ? 'Missing field' : formatFieldType(field.type) }}
                    </span>
                  </label>
                </div>
              </div>
              <div class="db-form-rules__section">
                <div class="db-form-rules__section-title">Autofill</div>
                <div class="db-form-rules__blocks">
                  <div v-for="field in resolvedActiveFormFields" :key="`autofill-${field.id}`" class="db-form-rule-block">
                    <div class="db-form-rule-block__row">
                      <span class="db-form-rule-block__pill">Field</span>
                      <span class="db-form-rule-block__target">{{ field.name }}</span>
                      <span class="db-form-rule-block__pill">Autofill</span>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.autoType"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldAutoType(field.id, $event.target.value)"
                      >
                        <option value="">None</option>
                        <option value="currentUser">Current user</option>
                        <option value="template">Template</option>
                        <option
                          value="fixed"
                          :disabled="(field.type !== 'SELECT' && field.type !== 'RELATION') || !field.autoFixedChoices.length"
                        >
                          Fixed value
                        </option>
                      </select>
                    </div>
                    <div v-if="field.autoType === 'fixed'" class="db-form-rule-block__row">
                      <span class="db-form-rule-block__pill">Value</span>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.autoFixedValue"
                        :disabled="field.missing || field.locked || isReadonly || !field.autoFixedChoices.length"
                        @change="updateFormFieldAutoFixedValue(field.id, $event.target.value)"
                      >
                        <option value="">{{ field.autoFixedPlaceholder }}</option>
                        <option v-for="choice in field.autoFixedChoices" :key="choice.value" :value="choice.value">
                          {{ choice.label || choice.value }}
                        </option>
                      </select>
                    </div>
                    <div v-if="field.autoType === 'fixed' && field.autoFixedHint" class="db-form-rule-block__hint muted">
                      {{ field.autoFixedHint }}
                    </div>
                    <div v-if="field.autoType === 'currentUser'" class="db-form-rule-block__row">
                      <span class="db-form-rule-block__pill">User value</span>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.autoMode"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldAutoMode(field.id, $event.target.value)"
                      >
                        <option value="name">Name</option>
                        <option value="id">User ID</option>
                      </select>
                    </div>
                    <div v-if="field.autoType === 'template'" class="db-form-rule-block__row">
                      <span class="db-form-rule-block__pill">Template</span>
                      <input
                        class="db-form-rule-block__input"
                        type="text"
                        :value="field.autoTemplate"
                        :disabled="field.missing || field.locked || isReadonly"
                        placeholder="Incident Report #{{counter}}"
                        @change="updateFormFieldAutoTemplate(field.id, $event.target.value)"
                      />
                    </div>
                    <div v-if="field.autoType === 'template'" class="db-form-rule-block__hint muted" v-pre>
                      Use {{counter}}, {{user}}, {{userId}}, {{date}}, {{datetime}}
                    </div>
                  </div>
                </div>
              </div>
              <div class="db-form-rules__section">
                <div class="db-form-rules__section-title">Conditional requirements</div>
                <div v-if="!ruleBlocks.length" class="db-form-empty muted">
                  No conditional rules yet.
                </div>
                <div v-else class="db-form-rules__blocks">
                  <div v-for="field in ruleBlocks" :key="field.id" class="db-form-rule-block">
                    <div class="db-form-rule-block__row">
                      <span class="db-form-rule-block__pill">If</span>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.requiredWhenFieldId"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldRequiredWhenField(field.id, $event.target.value)"
                      >
                        <option value="">Select field...</option>
                        <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                          {{ option.name }} ({{ formatFieldType(option.type) }})
                        </option>
                      </select>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.requiredWhenOp"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldRequiredWhenOp(field.id, $event.target.value)"
                      >
                        <option
                          v-for="option in getConditionOpOptions(field.requiredWhenFieldType, field.requiredWhenChoices.length)"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                      <select
                        v-if="field.requiredWhenOp === 'equals'"
                        class="db-form-rule-block__select"
                        :value="field.requiredWhenValue"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldRequiredWhenValue(field.id, $event.target.value)"
                      >
                        <option value="">Select value</option>
                        <option v-for="choice in field.requiredWhenChoices" :key="choice.value" :value="choice.value">
                          {{ choice.label || choice.value }}
                        </option>
                      </select>
                      <span class="db-form-rule-block__pill">Then require</span>
                      <span class="db-form-rule-block__target">{{ field.name }}</span>
                      <button
                        class="db-form-rule-block__remove"
                        type="button"
                        :disabled="field.missing || field.locked || isReadonly"
                        @click="clearFormFieldRequiredWhen(field.id)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
                <div class="db-form-rule-block db-form-rule-block--new">
                  <div class="db-form-rule-block__row">
                    <span class="db-form-rule-block__pill">If</span>
                    <select
                      v-model="newRuleConditionFieldId"
                      class="db-form-rule-block__select"
                      :disabled="!canCreateForms || isReadonly || !formConditionFieldOptions.length"
                    >
                      <option value="">Select field...</option>
                      <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                        {{ option.name }} ({{ formatFieldType(option.type) }})
                      </option>
                    </select>
                    <span class="db-form-rule-block__pill">Then require</span>
                    <select
                      v-model="newRuleTargetFieldId"
                      class="db-form-rule-block__select"
                      :disabled="!canCreateForms || isReadonly || !availableRuleTargets.length"
                    >
                      <option value="">Select field...</option>
                      <option v-for="option in availableRuleTargets" :key="option.id" :value="option.id">
                        {{ option.name }} ({{ formatFieldType(option.type) }})
                      </option>
                    </select>
                    <button
                      class="db-form-rule-block__add"
                      type="button"
                      :disabled="!canCreateForms || isReadonly || !newRuleConditionFieldId || !newRuleTargetFieldId"
                      @click="addRequiredWhenRule"
                    >
                      Add rule
                    </button>
                  </div>
                  <div v-if="!availableRuleTargets.length" class="db-form-rule-block__hint muted">
                    All fields already have a conditional rule.
                  </div>
                </div>
              </div>
              <div class="db-form-rules__section">
                <div class="db-form-rules__section-title">Visibility rules</div>
                <div v-if="!visibilityBlocks.length" class="db-form-empty muted">
                  No visibility rules yet.
                </div>
                <div v-else class="db-form-rules__blocks">
                  <div v-for="field in visibilityBlocks" :key="field.id" class="db-form-rule-block">
                    <div class="db-form-rule-block__row">
                      <span class="db-form-rule-block__pill">If</span>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.visibleWhenFieldId"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldVisibleWhenField(field.id, $event.target.value)"
                      >
                        <option value="">Select field...</option>
                        <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                          {{ option.name }} ({{ formatFieldType(option.type) }})
                        </option>
                      </select>
                      <select
                        class="db-form-rule-block__select"
                        :value="field.visibleWhenOp"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldVisibleWhenOp(field.id, $event.target.value)"
                      >
                        <option
                          v-for="option in getConditionOpOptions(field.visibleWhenFieldType, field.visibleWhenChoices.length)"
                          :key="option.value"
                          :value="option.value"
                        >
                          {{ option.label }}
                        </option>
                      </select>
                      <select
                        v-if="field.visibleWhenOp === 'equals'"
                        class="db-form-rule-block__select"
                        :value="field.visibleWhenValue"
                        :disabled="field.missing || field.locked || isReadonly"
                        @change="updateFormFieldVisibleWhenValue(field.id, $event.target.value)"
                      >
                        <option value="">Select value</option>
                        <option v-for="choice in field.visibleWhenChoices" :key="choice.value" :value="choice.value">
                          {{ choice.label || choice.value }}
                        </option>
                      </select>
                      <span class="db-form-rule-block__pill">Then show</span>
                      <span class="db-form-rule-block__target">{{ field.name }}</span>
                      <button
                        class="db-form-rule-block__remove"
                        type="button"
                        :disabled="field.missing || field.locked || isReadonly"
                        @click="clearFormFieldVisibleWhen(field.id)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
                <div class="db-form-rule-block db-form-rule-block--new">
                  <div class="db-form-rule-block__row">
                    <span class="db-form-rule-block__pill">If</span>
                    <select
                      v-model="newVisibilityConditionFieldId"
                      class="db-form-rule-block__select"
                      :disabled="!canCreateForms || isReadonly || !formConditionFieldOptions.length"
                    >
                      <option value="">Select field...</option>
                      <option v-for="option in formConditionFieldOptions" :key="option.id" :value="option.id">
                        {{ option.name }} ({{ formatFieldType(option.type) }})
                      </option>
                    </select>
                    <span class="db-form-rule-block__pill">Then show</span>
                    <select
                      v-model="newVisibilityTargetFieldId"
                      class="db-form-rule-block__select"
                      :disabled="!canCreateForms || isReadonly || !availableVisibilityTargets.length"
                    >
                      <option value="">Select field...</option>
                      <option v-for="option in availableVisibilityTargets" :key="option.id" :value="option.id">
                        {{ option.name }} ({{ formatFieldType(option.type) }})
                      </option>
                    </select>
                    <button
                      class="db-form-rule-block__add"
                      type="button"
                      :disabled="
                        !canCreateForms ||
                        isReadonly ||
                        !newVisibilityConditionFieldId ||
                        !newVisibilityTargetFieldId
                      "
                      @click="addVisibleWhenRule"
                    >
                      Add rule
                    </button>
                  </div>
                  <div v-if="!availableVisibilityTargets.length" class="db-form-rule-block__hint muted">
                    All fields already have a visibility rule.
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div v-else-if="formBuilderTab === 'layout'" class="db-form-layout">
            <div class="db-form-layout__hint muted">Preview only. Submissions are disabled.</div>
            <DatabaseFormPage v-if="activeForm?.id" :form-id="activeForm.id" embedded preview />
          </div>
        </template>
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
          <div class="block-menu__panel-scroll">
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
              <div class="block-menu__panel-scroll">
                <div class="db-form-field-controls">
                  <label class="db-form-field-label">Target database</label>
                  <select v-model="relationDraftPageId" class="db-form-field-select">
                    <option value="">Select database...</option>
                    <option v-for="page in relationTargetPages" :key="page.id" :value="page.id">
                      {{ page.title || 'Untitled database' }}
                    </option>
                  </select>
                  <div v-if="!relationTargetPages.length" class="db-options-empty">No databases available.</div>
                </div>
                <div class="db-form-field-controls">
                  <label class="db-form-field-label">Allow multiple</label>
                  <label class="db-form-field-checkbox">
                    <input type="checkbox" v-model="relationDraftAllowMultiple" />
                    Enable multi-select relations
                  </label>
                </div>
                <div class="db-form-field-controls">
                  <label class="db-form-field-label">Track history</label>
                  <label class="db-form-field-checkbox">
                    <input type="checkbox" v-model="relationDraftHistoryEnabled" />
                    Append-only relation log
                  </label>
                  <div v-if="relationDraftHistoryEnabled && relationDraftHistoryPageId" class="db-form-field-hint">
                    Logging to: {{ pageMap.get(relationDraftHistoryPageId)?.title || 'Relation history' }}
                  </div>
                </div>
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
        <button class="db-view-config__delete" type="button" @click="deleteSavedView(activeSavedView)">Delete view</button>
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
