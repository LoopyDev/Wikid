<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import { useApiMutation } from '../composables/useApiMutation';
import { conditionValues } from '../utils/database/forms';

const props = defineProps({
  formId: {
    type: String,
    required: true,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
  preview: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['open-page']);

const workspace = useWorkspaceStore();
const activeUser = computed(() => workspace.activeUser);
const submitStatus = ref('');
const form = ref(null);
const databaseFields = ref([]);
const databasePageId = ref('');
const databaseRowCount = ref(null);
const complianceMode = ref(false);
const GOVERNANCE_FILTER_ID = '__governanceStatus__';
const governanceStatusOptions = [
  { id: 'DRAFT', label: 'Draft' },
  { id: 'SUBMITTED', label: 'Submitted' },
  { id: 'REVIEW', label: 'In Review' },
  { id: 'CLOSED', label: 'Closed' },
  { id: 'ARCHIVED', label: 'Archived' },
];
const governanceStatusById = new Map(governanceStatusOptions.map((status) => [status.id, status.label]));
const isPreview = computed(() => props.preview === true);
const rows = ref([]);
const rowsLoading = ref(false);
const rowsError = ref('');
const activeRowId = ref('');
const successView = ref(false);
const values = ref({});
const fieldErrors = ref({});
const amendReason = ref('');
const amendReasonError = ref(false);
const requiredSubmitMessage = 'Please fill all required fields.';
const futureDateMessage = "Can't be in the future";
const autoRequiredErrorMessage = 'Autofill missing — contact the form author.';
const requiredInitDone = ref(false);
const submitHighlight = ref(false);
const submitShake = ref(false);
const flashFields = ref([]);
const flashRunId = ref(0);
let submitHighlightTimer = null;
let submitShakeTimer = null;
const relationOptionsByPageId = ref({});
const relationFieldsByPageId = ref({});
const relationRowsByPageId = ref({});
const relationOptionsLoading = ref({});
const relationOptionsError = ref({});

const normalizeChoice = (choice) => {
  if (typeof choice === 'string') {
    const value = choice.trim();
    return value ? { value, label: value } : null;
  }
  if (choice && typeof choice === 'object') {
    const value = typeof choice.value === 'string' ? choice.value.trim() : '';
    if (!value) return null;
    const label = typeof choice.label === 'string' ? choice.label.trim() : '';
    return { value, label: label || value };
  }
  return null;
};

// The workspace's members, for person fields (sent with the form when it has one)
const people = ref([]);

const getFieldChoices = (field) => {
  if (field?.type === 'PERSON') return people.value.map((person) => ({ value: person.id, label: person.name }));
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  const rawChoices = Array.isArray(options.choices) ? options.choices : [];
  return rawChoices.map(normalizeChoice).filter(Boolean);
};

const getRelationConfig = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
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

const normalizeFormSelectSource = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (type !== 'relation') return null;
  const relationFieldId = typeof raw.relationFieldId === 'string' ? raw.relationFieldId.trim() : '';
  const targetFieldId = typeof raw.targetFieldId === 'string' ? raw.targetFieldId.trim() : '';
  if (!relationFieldId || !targetFieldId) return null;
  return { type, relationFieldId, targetFieldId };
};

const normalizeRelationEntry = (raw) => {
  if (!raw) return null;
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

const relationOptionsForField = (field) => {
  const relation = getRelationConfig(field);
  if (!relation?.pageId) return [];
  return relationOptionsByPageId.value[relation.pageId] || [];
};

const relationFieldsForPage = (pageId) => relationFieldsByPageId.value[pageId] || [];
const relationRowsForPage = (pageId) => relationRowsByPageId.value[pageId] || [];

const relationOptionsLoadingForField = (field) => {
  const relation = getRelationConfig(field);
  if (!relation?.pageId) return false;
  return relationOptionsLoading.value[relation.pageId] === true;
};

const relationOptionsErrorForField = (field) => {
  const relation = getRelationConfig(field);
  if (!relation?.pageId) return '';
  return relationOptionsError.value[relation.pageId] || '';
};

const getSelectSourceConfig = (field) => {
  const selectSource =
    field?.selectSource && typeof field.selectSource === 'object' && !Array.isArray(field.selectSource)
      ? field.selectSource
      : null;
  if (!selectSource || selectSource.type !== 'relation') return null;
  const relationFieldId = typeof selectSource.relationFieldId === 'string' ? selectSource.relationFieldId : '';
  const targetFieldId = typeof selectSource.targetFieldId === 'string' ? selectSource.targetFieldId : '';
  if (!relationFieldId || !targetFieldId) return null;
  const relationField = fieldMap.value.get(relationFieldId);
  const relation = relationField ? getRelationConfig(relationField) : null;
  if (!relation?.pageId) return null;
  return { pageId: relation.pageId, targetFieldId };
};

const selectSourceOptionsForField = (field) => {
  const config = getSelectSourceConfig(field);
  if (!config) return [];
  const rows = relationRowsForPage(config.pageId);
  const seen = new Set();
  return rows
    .map((row) => {
      const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
      const raw = data[config.targetFieldId];
      const label = stringifyValue(raw);
      if (!label) return null;
      const value = String(label);
      if (seen.has(value)) return null;
      seen.add(value);
      return { value, label: value };
    })
    .filter(Boolean);
};

const selectSourceLoadingForField = (field) => {
  const config = getSelectSourceConfig(field);
  if (!config) return false;
  return relationOptionsLoading.value[config.pageId] === true;
};

const selectSourceErrorForField = (field) => {
  const config = getSelectSourceConfig(field);
  if (!config) return '';
  return relationOptionsError.value[config.pageId] || '';
};

const selectSourcePlaceholder = (field) => {
  const error = selectSourceErrorForField(field);
  if (error) return 'Failed to load';
  if (selectSourceLoadingForField(field)) return 'Loading...';
  return 'Select value...';
};

const getAutoFixedChoices = (field) => {
  if (!field) return [];
  if (field.type === 'RELATION') {
    return relationOptionsForField(field).map((option) => ({
      value: option.id,
      label: option.label || option.id,
    }));
  }
  if (field.type !== 'SELECT') return [];
  if (field.selectSource?.type === 'relation') {
    return selectSourceOptionsForField(field);
  }
  return getFieldChoices(field);
};

const loadRelationOptions = async (pageId) => {
  if (!pageId) return;
  if (!activeUser.value || !workspace.hasApi) return;
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
      targetFields.find((entry) => getFieldSource(entry) === 'page')?.id || targetFields[0]?.id || null;
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
    const selectSource =
      field?.selectSource && typeof field.selectSource === 'object' && !Array.isArray(field.selectSource)
        ? field.selectSource
        : null;
    if (selectSource?.type === 'relation') {
      const relationFieldId = typeof selectSource.relationFieldId === 'string' ? selectSource.relationFieldId : '';
      const relationField = relationFieldId ? fieldMap.value.get(relationFieldId) : null;
      const relationConfig = relationField ? getRelationConfig(relationField) : null;
      if (relationConfig?.pageId) targets.add(relationConfig.pageId);
    }
  });
  targets.forEach((pageId) => {
    void loadRelationOptions(pageId);
  });
};

const resolveRelationLabel = (field, entry) => {
  if (!entry) return '';
  if (entry.label) return entry.label;
  const options = relationOptionsForField(field);
  const match = options.find((option) => option.id === entry.id);
  return match?.label || entry.id || '';
};

const isFieldReadOnly = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  if (options.source === 'lastEdited') return true;
  if (options.source === 'page') return !!options.readonly;
  return !!options.readonly;
};

const getFieldSource = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  return typeof options.source === 'string' ? options.source : null;
};
const isAssetTagField = (field) => getFieldSource(field) === 'assetTag';
const fieldPlaceholder = (field) => (isAssetTagField(field) ? 'Generated on submit' : field.label);

const normalizeFormConfig = (rawConfig, options = {}) => {
  const base = { mode: 'create', filter: null, successMessage: '', showReturnButton: false, initialStatus: 'SUBMITTED' };
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return base;
  const mode = rawConfig.mode === 'update' ? 'update' : 'create';
  const allowGovernanceFilter = options?.complianceMode === true;
  let filter = null;
  if (rawConfig.filter && typeof rawConfig.filter === 'object' && !Array.isArray(rawConfig.filter)) {
    const fieldId = typeof rawConfig.filter.fieldId === 'string' ? rawConfig.filter.fieldId : '';
    const op = typeof rawConfig.filter.op === 'string' ? rawConfig.filter.op : 'isEmpty';
    const allowedOps = new Set(['isEmpty', 'isNotEmpty', 'equals', 'notEquals']);
    const validField = databaseFields.value.find((entry) => entry.id === fieldId);
    if (fieldId && allowGovernanceFilter && fieldId === GOVERNANCE_FILTER_ID && allowedOps.has(op)) {
      const rawValue = Object.prototype.hasOwnProperty.call(rawConfig.filter, 'value') ? rawConfig.filter.value : '';
      const normalized =
        typeof rawValue === 'string'
          ? rawValue.trim().toUpperCase()
          : rawValue === null || rawValue === undefined
          ? ''
          : String(rawValue).trim().toUpperCase();
      filter = { fieldId, op, value: normalized };
    } else if (fieldId && validField && allowedOps.has(op)) {
      filter = {
        fieldId,
        op,
        value: Object.prototype.hasOwnProperty.call(rawConfig.filter, 'value') ? rawConfig.filter.value : '',
      };
    }
  }
  const successMessage = typeof rawConfig.successMessage === 'string' ? rawConfig.successMessage : '';
  const showReturnButton = rawConfig.showReturnButton === true;
  const rawStatus = typeof rawConfig.initialStatus === 'string' ? rawConfig.initialStatus.trim().toUpperCase() : '';
  const allowedStatuses = new Set(['DRAFT', 'SUBMITTED', 'REVIEW', 'CLOSED', 'ARCHIVED']);
  const initialStatus = allowedStatuses.has(rawStatus) ? rawStatus : 'SUBMITTED';
  return { mode, filter, successMessage, showReturnButton, initialStatus };
};

const formConfig = computed(() => normalizeFormConfig(form.value?.config, { complianceMode: complianceMode.value }));
const formMode = computed(() => formConfig.value.mode);
const isUpdateMode = computed(() => formMode.value === 'update');
const requiresAmendReason = computed(() => complianceMode.value && isUpdateMode.value);

const fieldMap = computed(() => new Map(databaseFields.value.map((entry) => [entry.id, entry])));
const titleFieldId = computed(
  () => databaseFields.value.find((field) => getFieldSource(field) === 'page')?.id || null
);

const autoCounter = computed(() => (Number.isFinite(databaseRowCount.value) ? databaseRowCount.value + 1 : null));

const resolveTemplate = (template) => {
  const userId = activeUser.value?.id || '';
  const userName = activeUser.value?.name || userId || '';
  const counter = autoCounter.value;
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    const token = String(key || '').trim();
    if (token === 'counter') return counter ? String(counter) : '';
    if (token === 'user') return userName;
    if (token === 'userId') return userId;
    if (token === 'date') return new Date().toISOString().slice(0, 10);
    if (token === 'datetime') return new Date().toISOString();
    return '';
  });
};

// Today's date where the person filling in the form is (the server checks it's within a day)
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const resolveAutoValue = (field, auto) => {
  if (!auto || !field) return undefined;
  if (auto.type === 'today') {
    return field.type === 'DATE' ? localToday() : undefined;
  }
  if (auto.type === 'currentUser') {
    // A person field holds the person filling it in
    if (field.type === 'PERSON') return activeUser.value?.id ? [activeUser.value.id] : undefined;
    const source = getFieldSource(field);
    const mode = auto.mode === 'id' || auto.mode === 'name' ? auto.mode : source === 'members' ? 'id' : 'name';
    const value = mode === 'id' ? activeUser.value?.id : activeUser.value?.name || activeUser.value?.id;
    if (!value) return undefined;
    if (field.type === 'MULTI_SELECT') {
      return [value];
    }
    return value;
  }
  if (auto.type === 'fixed') {
    const value = typeof auto.value === 'string' ? auto.value.trim() : '';
    if (!value) return undefined;
    if (field.type === 'SELECT') {
      const choices = getAutoFixedChoices(field).map((choice) => choice.value);
      if (!choices.includes(value)) return undefined;
      return value;
    }
    if (field.type === 'RELATION') {
      return value;
    }
    return undefined;
  }
  if (auto.type === 'template' && typeof auto.template === 'string') {
    const rendered = resolveTemplate(auto.template);
    if (!rendered) return undefined;
    if (field.type === 'NUMBER') {
      const num = Number(rendered);
      return Number.isFinite(num) ? num : undefined;
    }
    return rendered;
  }
  return undefined;
};

const resolvedFields = computed(() => {
  if (!form.value) return [];
  const fieldMap = new Map(databaseFields.value.map((entry) => [entry.id, entry]));
  return form.value.fields.map((entry) => {
    const field = fieldMap.get(entry.fieldId);
    const rawLabel = typeof entry.label === 'string' ? entry.label.trim() : '';
    const label = rawLabel || field?.name || 'Field';
    const auto = entry?.auto && typeof entry.auto === 'object' && !Array.isArray(entry.auto) ? entry.auto : null;
    const editable = entry?.editable === false ? false : true;
    const baseReadOnly = field ? isFieldReadOnly(field) : true;
    const requiredWhen =
      entry?.requiredWhen && typeof entry.requiredWhen === 'object' && !Array.isArray(entry.requiredWhen)
        ? entry.requiredWhen
        : null;
    const visibleWhen =
      entry?.visibleWhen && typeof entry.visibleWhen === 'object' && !Array.isArray(entry.visibleWhen)
        ? entry.visibleWhen
        : null;
    const selectSource = normalizeFormSelectSource(entry?.selectSource);
    return {
      id: entry.fieldId,
      label,
      type: field?.type || null,
      options: field?.options || {},
      required: !!entry.required,
      selectSource,
      requiredWhen,
      visibleWhen,
      editable,
      // An autofilled field is a starting value people can change, unless it isn't editable:
      // then it's locked, and the server sets it
      readOnly: baseReadOnly || !editable,
      autoLocked: !!auto && !editable,
      missing: !field,
      auto,
      autoValue: field && auto ? resolveAutoValue(field, auto) : undefined,
      noFuture: entry?.noFuture === true && field?.type === 'DATE',
    };
  });
});

const normalizeRow = (row) => ({
  ...row,
  data: row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...row.data } : {},
});

const stringifyValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const label = value.label ?? value.id;
    if (label !== undefined && label !== null && String(label).trim()) {
      return String(label);
    }
  }
  if (value === null || value === undefined) return '';
  return String(value);
};

const isEmptyValue = (value) => {
  if (Array.isArray(value)) return value.length === 0;
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
};

const normalizeCheckboxValue = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return null;
    if (['true', 'yes', '1'].includes(trimmed)) return true;
    if (['false', 'no', '0'].includes(trimmed)) return false;
  }
  return null;
};

const normalizeFilterValue = (field, value) => {
  if (!field) return value;
  if (field.type === 'NUMBER') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const num = Number(String(value ?? '').trim());
    return Number.isFinite(num) ? num : null;
  }
  if (field.type === 'CHECKBOX') {
    return normalizeCheckboxValue(value);
  }
  if (field.type === 'MULTI_SELECT' || field.type === 'PERSON') {
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).filter((item) => item);
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }
  if (field.type === 'RELATION') {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeRelationEntry(entry)?.id).filter(Boolean);
    }
    const entry = normalizeRelationEntry(value);
    return entry?.id || '';
  }
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value);
};

const normalizeGovernanceStatus = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : '';
};

const matchesFilter = (row) => {
  const filter = formConfig.value.filter;
  if (!filter) return true;
  if (filter.fieldId === GOVERNANCE_FILTER_ID) {
    const rowStatus = normalizeGovernanceStatus(row?.complianceStatus);
    if (filter.op === 'isEmpty') return !rowStatus;
    if (filter.op === 'isNotEmpty') return !!rowStatus;
    const filterValue = normalizeGovernanceStatus(filter.value);
    if (!filterValue) return true;
    const matches = rowStatus === filterValue;
    return filter.op === 'equals' ? matches : !matches;
  }
  const field = fieldMap.value.get(filter.fieldId);
  if (!field) return true;
  const rowValue = normalizeFilterValue(field, row?.data?.[filter.fieldId]);
  if (filter.op === 'isEmpty') return isEmptyValue(rowValue);
  if (filter.op === 'isNotEmpty') return !isEmptyValue(rowValue);
  const filterValue = normalizeFilterValue(field, filter.value);
  if (isEmptyValue(filterValue)) return true;
  let matches = false;
  if (Array.isArray(rowValue)) {
    if (Array.isArray(filterValue)) {
      matches = filterValue.every((item) => rowValue.includes(String(item)));
    } else if (filterValue) {
      matches = rowValue.includes(String(filterValue));
    }
  } else if (field.type === 'CHECKBOX') {
    if (rowValue === null || filterValue === null) {
      matches = false;
    } else {
      matches = rowValue === filterValue;
    }
  } else if (field.type === 'NUMBER') {
    if (typeof rowValue === 'number' && typeof filterValue === 'number') {
      matches = rowValue === filterValue;
    } else {
      matches = String(rowValue ?? '') === String(filterValue ?? '');
    }
  } else {
    matches = String(rowValue ?? '') === String(filterValue ?? '');
  }
  return filter.op === 'equals' ? matches : !matches;
};

const filteredRows = computed(() => {
  if (!isUpdateMode.value) return [];
  return rows.value.filter((row) => matchesFilter(row));
});

const activeRow = computed(() => rows.value.find((row) => row.id === activeRowId.value) || null);
const activeRowTitle = computed(() => {
  if (!activeRow.value) return '';
  const titleField = titleFieldId.value;
  const data = activeRow.value?.data || {};
  if (titleField && Object.prototype.hasOwnProperty.call(data, titleField)) {
    const value = data[titleField];
    const text = stringifyValue(value);
    if (text) return text;
  }
  return 'Untitled record';
});

const resolveRowTitle = (row) => {
  const titleField = titleFieldId.value;
  const data = row?.data || {};
  if (titleField && Object.prototype.hasOwnProperty.call(data, titleField)) {
    const text = stringifyValue(data[titleField]);
    if (text) return text;
  }
  return 'Untitled record';
};

const formSuccessMessage = computed(() => {
  if (submitStatus.value) return submitStatus.value;
  if (formConfig.value.successMessage) return formConfig.value.successMessage;
  return isUpdateMode.value ? 'Saved.' : 'Submitted.';
});

const headerSubtitle = computed(() => {
  if (isUpdateMode.value) {
    if (successView.value) return 'Update saved.';
    if (!activeRow.value) return 'Select a record to update.';
    return 'Update the selected record.';
  }
  return 'Fill out the form to create a new row.';
});

const filterSummary = computed(() => {
  const filter = formConfig.value.filter;
  if (!filter) return 'All records';
  const isGovernance = filter.fieldId === GOVERNANCE_FILTER_ID;
  const field = isGovernance ? null : fieldMap.value.get(filter.fieldId);
  if (!isGovernance && !field) return 'All records';
  const opLabels = {
    isEmpty: 'is empty',
    isNotEmpty: 'is not empty',
    equals: 'equals',
    notEquals: 'does not equal',
  };
  const label = isGovernance ? 'Governance status' : field?.name || 'Field';
  const opText = opLabels[filter.op] || filter.op;
  if (filter.op === 'equals' || filter.op === 'notEquals') {
    const valueText = isGovernance
      ? governanceStatusById.get(normalizeGovernanceStatus(filter.value)) || stringifyValue(filter.value)
      : stringifyValue(filter.value);
    return valueText ? `${label} ${opText} ${valueText}` : `${label} ${opText}`;
  }
  return `${label} ${opText}`;
});

const showRecordList = computed(() => isUpdateMode.value && !activeRow.value && !successView.value);
const showSuccess = computed(() => isUpdateMode.value && successView.value);

// What a field holds: a locked autofill's value, or what's been entered, starting from the autofill
const effectiveValue = (field, overrideValue, hasOverride = false) => {
  const hasAuto = !!field.auto && field.autoValue !== undefined;
  if (hasAuto && field.autoLocked) return field.autoValue;
  const hasStored = hasOverride || Object.prototype.hasOwnProperty.call(values.value, field.id);
  if (hasAuto && !hasStored) return field.autoValue;
  return hasOverride ? overrideValue : values.value[field.id];
};

const valueForField = (field) => {
  const resolved = effectiveValue(field);
  if (isAssetTagField(field)) {
    if (resolved !== undefined && resolved !== null && String(resolved).trim()) {
      return resolved;
    }
    return activeRow.value?.id || '';
  }
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (relation?.allowMultiple) {
      if (Array.isArray(resolved)) {
        return resolved
          .map((entry) => normalizeRelationEntry(entry))
          .filter(Boolean)
          .map((entry) => entry.id);
      }
      const entry = normalizeRelationEntry(resolved);
      return entry?.id ? [entry.id] : [];
    }
    const entry = normalizeRelationEntry(resolved);
    return entry?.id || '';
  }
  if (field.type === 'MULTI_SELECT') {
    return Array.isArray(resolved) ? resolved : [];
  }
  // One person: a plain select holds its id
  if (field.type === 'PERSON') {
    const ids = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
    return field.options?.allowMultiple === true ? ids : ids[0] || '';
  }
  if (field.type === 'CHECKBOX') {
    return resolved === true;
  }
  return resolved ?? '';
};

const resolvedFieldMap = computed(() => new Map(resolvedFields.value.map((field) => [field.id, field])));

const isRuleConditionMet = (condition) => {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false;
  const conditionFieldId = typeof condition.fieldId === 'string' ? condition.fieldId : '';
  if (!conditionFieldId) return false;
  const conditionField = resolvedFieldMap.value.get(conditionFieldId);
  if (!conditionField) return false;
  const rawValue = valueForField(conditionField);
  const op = typeof condition.op === 'string' ? condition.op.trim() : 'equals';
  if (op === 'isFilled' || op === 'isEmpty') {
    const missing = isMissingRequiredValue(conditionField, rawValue);
    return op === 'isEmpty' ? missing : !missing;
  }
  if (op !== 'equals' && op !== 'isAnyOf') return false;
  const expected = conditionValues(condition);
  if (!expected.length) return false;
  if (Array.isArray(rawValue)) {
    return rawValue.some((item) => expected.includes(String(item)));
  }
  return expected.includes(String(rawValue ?? '').trim());
};

const isFieldVisibleNow = (field) => {
  const condition =
    field?.visibleWhen && typeof field.visibleWhen === 'object' && !Array.isArray(field.visibleWhen)
      ? field.visibleWhen
      : null;
  if (!condition) return true;
  return isRuleConditionMet(condition);
};

const isConditionMet = (field) => {
  const condition =
    field?.requiredWhen && typeof field.requiredWhen === 'object' && !Array.isArray(field.requiredWhen)
      ? field.requiredWhen
      : null;
  if (!condition) return false;
  return isRuleConditionMet(condition);
};

const isFieldRequiredNow = (field) => isFieldVisibleNow(field) && (field.required || isConditionMet(field));

const isMissingRequiredValue = (field, value) => {
  if (field.type === 'RELATION') {
    if (Array.isArray(value)) {
      return !value.some((entry) => normalizeRelationEntry(entry)?.id);
    }
    return !normalizeRelationEntry(value)?.id;
  }
  if (field.type === 'MULTI_SELECT') {
    return !Array.isArray(value) || value.length === 0;
  }
  if (field.type === 'PERSON') {
    return Array.isArray(value) ? value.length === 0 : !value;
  }
  if (field.type === 'CHECKBOX') {
    return value !== true;
  }
  if (field.type === 'NUMBER') {
    return value === undefined || value === null || String(value).trim() === '';
  }
  return value === undefined || value === null || String(value).trim() === '';
};

const isFieldMissingRequired = (field, overrideValue, hasOverride = false) => {
  if (field.missing || !isFieldRequiredNow(field)) return false;
  if (field.readOnly && !field.auto) return false;
  return isMissingRequiredValue(field, effectiveValue(field, overrideValue, hasOverride));
};

const hasRequiredFields = computed(() =>
  resolvedFields.value.some((field) => isFieldRequiredNow(field) && !field.missing && (!field.readOnly || field.auto))
);

const requiredComplete = computed(() => {
  if (!hasRequiredFields.value) return false;
  return !resolvedFields.value.some((field) => isFieldMissingRequired(field));
});

const visibleFields = computed(() => resolvedFields.value.filter((field) => isFieldVisibleNow(field)));

const isSubmitBlocked = computed(() => hasRequiredFields.value && !requiredComplete.value);
const hasSubmitRequiredError = computed(() => submitError.value === requiredSubmitMessage);
const shouldShowBlockedError = computed(() => hasSubmitRequiredError.value && isSubmitBlocked.value);
const flashOrderMap = computed(
  () => new Map(flashFields.value.map((fieldId, index) => [fieldId, index]))
);
const flashClassName = computed(() => (flashRunId.value % 2 === 0 ? 'form-field--flash-a' : 'form-field--flash-b'));

const clearSubmitHighlight = () => {
  if (submitHighlightTimer) {
    clearTimeout(submitHighlightTimer);
    submitHighlightTimer = null;
  }
  submitHighlight.value = false;
};

const clearSubmitShake = () => {
  if (submitShakeTimer) {
    clearTimeout(submitShakeTimer);
    submitShakeTimer = null;
  }
  submitShake.value = false;
};

const clearSubmitFlash = () => {
  flashFields.value = [];
};

const resetFormInputs = () => {
  values.value = {};
  fieldErrors.value = {};
  amendReason.value = '';
  amendReasonError.value = false;
  requiredInitDone.value = false;
  clearSubmitHighlight();
  clearSubmitShake();
  clearSubmitFlash();
};

const triggerSubmitHighlight = () => {
  if (typeof window === 'undefined') return;
  clearSubmitHighlight();
  requestAnimationFrame(() => {
    submitHighlight.value = true;
    submitHighlightTimer = window.setTimeout(() => {
      submitHighlight.value = false;
      submitHighlightTimer = null;
    }, 900);
  });
};

const triggerSubmitShake = () => {
  if (typeof window === 'undefined') return;
  clearSubmitShake();
  requestAnimationFrame(() => {
    submitShake.value = true;
    submitShakeTimer = window.setTimeout(() => {
      submitShake.value = false;
      submitShakeTimer = null;
    }, 520);
  });
};

const collectMissingRequiredIds = () =>
  resolvedFields.value.filter((field) => isFieldMissingRequired(field)).map((field) => field.id);

const triggerRequiredFlash = async (missingIds) => {
  if (typeof window === 'undefined') return;
  if (!missingIds.length) return;
  clearSubmitFlash();
  flashFields.value = missingIds;
  flashRunId.value += 1;
  await nextTick();
};

const clearFieldErrorIfResolved = (fieldId, overrideValue, hasOverride = false) => {
  if (!fieldErrors.value[fieldId]) return;
  const field = resolvedFields.value.find((entry) => entry.id === fieldId);
  if (!field) return;
  const value = hasOverride ? overrideValue : values.value[fieldId];
  if (!isFieldMissingRequired(field, overrideValue, hasOverride) && !isFutureDate(field, value)) {
    const next = { ...fieldErrors.value };
    delete next[fieldId];
    fieldErrors.value = next;
  }
};

const resetState = () => {
  resetFormInputs();
  submitStatus.value = '';
  submitError.value = '';
  successView.value = false;
  activeRowId.value = '';
  rowsLoading.value = false;
  rowsError.value = '';
};

const loadRows = async () => {
  if (!databasePageId.value || !activeUser.value || !workspace.hasApi) return;
  rowsLoading.value = true;
  rowsError.value = '';
  try {
    const res = await api.getDatabase(databasePageId.value, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    rows.value = Array.isArray(res?.rows) ? res.rows.map(normalizeRow) : [];
    if (activeRowId.value && !rows.value.some((row) => row.id === activeRowId.value)) {
      activeRowId.value = '';
      successView.value = false;
    }
    if (Array.isArray(res?.fields)) {
      databaseFields.value = res.fields;
    }
    if (Array.isArray(res?.rows)) {
      databaseRowCount.value = res.rows.length;
    }
  } catch (err) {
    console.warn('Load records failed', err);
    rowsError.value = err?.message || 'Failed to load records';
    rows.value = [];
  } finally {
    rowsLoading.value = false;
  }
};

const { loading, error, execute: loadForm } = useApiMutation(async () => {
  if (!props.formId || !activeUser.value || !workspace.hasApi) return;
  resetState();
  try {
    const res = await api.getDatabaseForm(props.formId, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    form.value = {
      id: res?.id || props.formId,
      name: res?.name || 'Form',
      fields: Array.isArray(res?.fields) ? res.fields : [],
      config: res?.config && typeof res.config === 'object' && !Array.isArray(res.config) ? res.config : null,
    };
    databaseFields.value = Array.isArray(res?.databaseFields) ? res.databaseFields : [];
    people.value = Array.isArray(res?.people) ? res.people : [];
    databasePageId.value = typeof res?.databasePageId === 'string' ? res.databasePageId : '';
    databaseRowCount.value = Number.isFinite(res?.databaseRowCount) ? res.databaseRowCount : null;
    complianceMode.value = res?.databaseComplianceMode === true;
    rows.value = [];
    rowsError.value = '';
  } finally {
    await nextTick();
    requiredInitDone.value = true;
  }
});

const seedValuesFromRow = (row) => {
  const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
  const next = {};
  resolvedFields.value.forEach((field) => {
    if (field.missing) return;
    if (Object.prototype.hasOwnProperty.call(data, field.id)) {
      next[field.id] = data[field.id];
    }
  });
  values.value = next;
};

const handleSelectRow = async (row) => {
  if (!row?.id) return;
  activeRowId.value = row.id;
  successView.value = false;
  submitStatus.value = '';
  submitError.value = '';
  resetFormInputs();
  seedValuesFromRow(row);
  await nextTick();
  requiredInitDone.value = true;
};

const handleReturnToList = async () => {
  activeRowId.value = '';
  successView.value = false;
  submitStatus.value = '';
  submitError.value = '';
  resetFormInputs();
  await nextTick();
  requiredInitDone.value = true;
};

const updateFieldValue = (fieldId, value) => {
  values.value = { ...values.value, [fieldId]: value };
  clearFieldErrorIfResolved(fieldId, value, true);
};

const updateRelationValue = (field, event) => {
  if (!field) return;
  const relation = getRelationConfig(field);
  const target = event?.target;
  if (relation?.allowMultiple) {
    if (!target) return;
    const selected = Array.from(target.selectedOptions || []).map((option) => option.value).filter(Boolean);
    updateFieldValue(field.id, selected);
    return;
  }
  const id = target?.value ?? '';
  if (!id) {
    updateFieldValue(field.id, null);
    return;
  }
  const match = relationOptionsForField(field).find((option) => option.id === id);
  updateFieldValue(field.id, { id: String(id), label: match?.label || '' });
};

const updateMultiSelectValue = (fieldId, event) => {
  const target = event?.target;
  if (!target) return;
  const selected = Array.from(target.selectedOptions || []).map((option) => option.value).filter(Boolean);
  updateFieldValue(fieldId, selected);
};

const updateAmendReason = (event) => {
  amendReason.value = event?.target?.value ?? '';
  amendReasonError.value = false;
};

const validateForm = () => {
  const errors = {};
  resolvedFields.value.forEach((field) => {
    if (isFieldMissingRequired(field)) {
      errors[field.id] = field.autoLocked ? autoRequiredErrorMessage : 'Required';
    }
  });
  fieldErrors.value = errors;
  return !Object.keys(errors).length;
};

// A "no future" date later than today, as the person's own calendar has it
const isFutureDate = (field, value) =>
  !!field?.noFuture && !field.readOnly && typeof value === 'string' && !!value && value.slice(0, 10) > localToday();

const buildSubmitData = () => {
  const data = {};
  resolvedFields.value.forEach((field) => {
    if (field.missing) return;
    const hasAuto = !!field.auto && field.autoValue !== undefined;
    if (!isFieldVisibleNow(field) && !hasAuto) return;
    if (field.readOnly && !hasAuto) return;
    const value = effectiveValue(field);
    if (field.type === 'RELATION') {
      if (Array.isArray(value)) {
        const entries = value.map((entry) => normalizeRelationEntry(entry)).filter(Boolean);
        if (entries.length) {
          data[field.id] = entries.map((entry) => ({ id: entry.id, label: resolveRelationLabel(field, entry) }));
        }
      } else {
        const entry = normalizeRelationEntry(value);
        if (entry?.id) {
          data[field.id] = { id: entry.id, label: resolveRelationLabel(field, entry) };
        }
      }
      return;
    }
    if (field.type === 'MULTI_SELECT') {
      if (Array.isArray(value) && value.length) {
        data[field.id] = value;
      }
      return;
    }
    if (field.type === 'PERSON') {
      const ids = (Array.isArray(value) ? value : [value]).filter((id) => typeof id === 'string' && id);
      if (ids.length) data[field.id] = ids;
      return;
    }
    if (field.type === 'CHECKBOX') {
      if (typeof value === 'boolean') {
        data[field.id] = value;
      }
      return;
    }
    if (value === undefined || value === null) return;
    const trimmed = String(value).trim();
    if (!trimmed) return;
    data[field.id] = value;
  });
  return data;
};

const { loading: submitting, error: submitError, execute: submitForm } = useApiMutation(async () => {
  if (!props.formId || !activeUser.value || !workspace.hasApi) return;
  if (isPreview.value) {
    submitError.value = 'Preview only.';
    triggerSubmitShake();
    return;
  }
  submitStatus.value = '';
  amendReasonError.value = false;
  if (isUpdateMode.value && !activeRow.value) {
    submitError.value = 'Select a record to update.';
    return;
  }
  if (requiresAmendReason.value && !amendReason.value.trim()) {
    amendReasonError.value = true;
    submitError.value = 'Reason is required for compliance amendments.';
    triggerSubmitShake();
    return;
  }
  if (!validateForm()) {
    submitError.value = requiredSubmitMessage;
    triggerSubmitShake();
    triggerRequiredFlash(collectMissingRequiredIds());
    return;
  }
  const futureIds = resolvedFields.value
    .filter((field) => isFieldVisibleNow(field) && isFutureDate(field, values.value[field.id]))
    .map((field) => field.id);
  if (futureIds.length) {
    fieldErrors.value = Object.fromEntries(futureIds.map((id) => [id, futureDateMessage]));
    submitError.value = "Dates can't be in the future.";
    triggerSubmitShake();
    return;
  }
  const payload = { data: buildSubmitData() };
  if (isUpdateMode.value && activeRow.value?.id) {
    payload.rowId = activeRow.value.id;
  }
  if (requiresAmendReason.value) {
    payload.reason = amendReason.value.trim();
  }
  const res = await api.submitDatabaseForm(props.formId, payload, {
    userId: activeUser.value.id,
    userName: activeUser.value.name,
  });
  resetFormInputs();
  if (isUpdateMode.value) {
    const updatedRow = res?.row || res;
    if (updatedRow?.id) {
      const normalized = normalizeRow(updatedRow);
      rows.value = rows.value.map((row) => (row.id === normalized.id ? { ...row, ...normalized } : row));
    }
    submitStatus.value = res?.transitionError
      ? `Saved, but status transition failed: ${res.transitionError}`
      : '';
    successView.value = true;
  } else {
    if (Number.isFinite(databaseRowCount.value)) {
      databaseRowCount.value += 1;
    }
    submitStatus.value = formSuccessMessage.value;
  }
});

const handleOpenDatabase = () => {
  if (!databasePageId.value) return;
  emit('open-page', databasePageId.value);
};

const shouldGhostSubmitError = computed(
  () => !!submitError.value && submitError.value === requiredSubmitMessage && requiredComplete.value
);

watch(
  () => [props.formId, activeUser.value?.id, workspace.hasApi],
  () => {
    loadForm();
  },
  { immediate: true }
);

watch(
  () =>
    resolvedFields.value.map((field) => {
      const relationPageId = getRelationConfig(field)?.pageId || '';
      const selectSource = field.selectSource?.type === 'relation' ? field.selectSource : null;
      const selectKey = selectSource ? `${selectSource.relationFieldId || ''}:${selectSource.targetFieldId || ''}` : '';
      return `${field.id}:${field.type}:${relationPageId}:${selectKey}`;
    }),
  () => {
    primeRelationOptions(resolvedFields.value);
  }
);

watch(
  () => [databasePageId.value, isUpdateMode.value, activeUser.value?.id, workspace.hasApi],
  ([pageId, updateMode, userId, hasApi]) => {
    if (!updateMode) {
      rows.value = [];
      rowsError.value = '';
      rowsLoading.value = false;
      activeRowId.value = '';
      successView.value = false;
      return;
    }
    if (!pageId || !userId || !hasApi) return;
    loadRows();
  }
);

watch(
  requiredComplete,
  (next, prev) => {
    if (!requiredInitDone.value) {
      requiredInitDone.value = true;
      return;
    }
    if (!prev && next) {
      triggerSubmitHighlight();
    }
  }
);

watch(
  resolvedFields,
  () => {
    const existing = Object.keys(fieldErrors.value);
    if (!existing.length) return;
    let changed = false;
    const next = { ...fieldErrors.value };
    resolvedFields.value.forEach((field) => {
      if (!next[field.id]) return;
      if (!isFieldMissingRequired(field)) {
        delete next[field.id];
        changed = true;
      }
    });
    if (changed) {
      fieldErrors.value = next;
    }
  },
  { deep: true }
);

onBeforeUnmount(() => {
  clearSubmitHighlight();
  clearSubmitShake();
  clearSubmitFlash();
});
</script>

<template>
  <div class="form-page" :class="{ 'form-page--embedded': embedded }">
    <div v-if="!embedded" class="form-page__header">
      <div>
        <div class="form-page__title">{{ form?.name || 'Form' }}</div>
        <div class="form-page__subtitle muted">{{ headerSubtitle }}</div>
      </div>
      <div class="form-page__actions">
        <button
          v-if="isUpdateMode && (activeRowId || successView)"
          class="ghost-btn ghost-btn-background form-page__back"
          type="button"
          @click="handleReturnToList"
        >
          Back to list
        </button>
        <button
          v-if="databasePageId"
          class="ghost-btn ghost-btn-background form-page__back"
          type="button"
          @click="handleOpenDatabase"
        >
          Back to database
        </button>
      </div>
    </div>
    <div v-if="loading" class="muted">Loading form...</div>
    <div v-else-if="error" class="alert">{{ error }}</div>
    <div v-else>
      <div v-if="showSuccess" class="form-page__body">
        <div class="form-success">
          <div class="form-success__title">All set</div>
          <div class="form-success__message">{{ formSuccessMessage }}</div>
          <div v-if="formConfig.showReturnButton" class="form-success__actions">
            <button class="ghost-btn ghost-btn-background" type="button" @click="handleReturnToList">
              Back to list
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="showRecordList" class="form-page__body">
        <div class="form-records">
          <div class="form-records__header">
            <div>
              <div class="form-records__title">Records</div>
              <div class="form-records__meta">{{ filterSummary }}</div>
            </div>
            <div class="form-records__count">{{ filteredRows.length }} records</div>
          </div>
          <div v-if="rowsLoading" class="muted">Loading records...</div>
          <div v-else-if="rowsError" class="alert">{{ rowsError }}</div>
          <div v-else-if="!filteredRows.length" class="muted">No records match this filter.</div>
          <div v-else class="form-records__list">
            <button
              v-for="(row, index) in filteredRows"
              :key="row.id"
              class="form-records__item"
              type="button"
              @click="handleSelectRow(row)"
            >
              <div class="form-records__info">
                <div class="form-records__name">{{ resolveRowTitle(row) }}</div>
                <div class="form-records__meta">Record {{ index + 1 }}</div>
              </div>
              <span class="form-records__chevron">&gt;</span>
            </button>
          </div>
        </div>
      </div>
      <form v-else class="form-page__body" @submit.prevent="submitForm">
        <div v-if="isPreview" class="form-field__note muted">Preview only. Submissions are disabled.</div>
        <div v-if="isUpdateMode" class="form-record-banner">
          <div>
            <div class="form-record-banner__label">Editing</div>
            <div class="form-record-banner__title">{{ activeRowTitle }}</div>
          </div>
          <button class="ghost-btn ghost-btn-background" type="button" @click="handleReturnToList">
            Back to list
          </button>
        </div>
        <div v-if="!isUpdateMode || activeRow" class="form-field">
          <div class="form-field__label-row">
            <label class="form-field__label">Item ID</label>
          </div>
          <input
            class="form-input form-input--readonly"
            type="text"
            :value="activeRow ? activeRow.id : ''"
            placeholder="Generated on submit"
            readonly
          />
          <div v-if="!activeRow" class="form-field__note muted">Generated when the record is created.</div>
        </div>
        <div v-if="!resolvedFields.length" class="muted">No fields configured for this form.</div>
        <div
          v-for="field in visibleFields"
          :key="field.id"
          class="form-field"
          :class="flashOrderMap.has(field.id) ? flashClassName : ''"
          :style="flashOrderMap.has(field.id) ? { '--flash-delay': `${flashOrderMap.get(field.id) * 120}ms` } : null"
        >
          <div class="form-field__label-row">
            <label class="form-field__label">{{ field.label }}</label>
            <span
              v-if="fieldErrors[field.id] && (field.autoLocked || fieldErrors[field.id] === futureDateMessage)"
              class="form-field__error"
            >
              {{ fieldErrors[field.id] }}
            </span>
            <span
              v-else-if="isFieldRequiredNow(field) && !field.missing && !field.autoLocked"
              class="form-field__required"
              :class="{ 'form-field__required--error': fieldErrors[field.id] }"
            >
              Required
            </span>
          </div>
          <div v-if="field.missing" class="form-field__note muted">This field no longer exists in the database.</div>
          <template v-else>
            <input
              v-if="field.type === 'TEXT' || field.type === 'URL'"
              class="form-input"
              type="text"
              :placeholder="fieldPlaceholder(field)"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @input="updateFieldValue(field.id, $event.target.value)"
            />
            <input
              v-else-if="field.type === 'NUMBER'"
              class="form-input"
              type="number"
              :placeholder="field.label"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @input="updateFieldValue(field.id, $event.target.value)"
            />
            <input
              v-else-if="field.type === 'DATE'"
              class="form-input"
              type="date"
              :value="valueForField(field)"
              :max="field.noFuture ? localToday() : undefined"
              :disabled="field.readOnly"
              @input="updateFieldValue(field.id, $event.target.value)"
            />
            <select
              v-else-if="field.type === 'RELATION' && getRelationConfig(field)?.allowMultiple"
              class="form-input form-input--multi"
              multiple
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @change="updateRelationValue(field, $event)"
            >
              <option v-for="option in relationOptionsForField(field)" :key="option.id" :value="option.id">
                {{ option.label || option.id }}
              </option>
            </select>
            <select
              v-else-if="field.type === 'RELATION'"
              class="form-input"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @change="updateRelationValue(field, $event)"
            >
              <option value="">Select record...</option>
              <option v-for="option in relationOptionsForField(field)" :key="option.id" :value="option.id">
                {{ option.label || option.id }}
              </option>
            </select>
            <select
              v-else-if="field.type === 'SELECT' && field.selectSource?.type === 'relation'"
              class="form-input"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @change="updateFieldValue(field.id, $event.target.value)"
            >
              <option value="">{{ selectSourcePlaceholder(field) }}</option>
              <option
                v-for="option in selectSourceOptionsForField(field)"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <select
              v-else-if="field.type === 'SELECT'"
              class="form-input"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @change="updateFieldValue(field.id, $event.target.value)"
            >
              <option value="">Select...</option>
              <option v-for="choice in getFieldChoices(field)" :key="choice.value" :value="choice.value">
                {{ choice.label }}
              </option>
            </select>
            <select
              v-else-if="field.type === 'PERSON' && field.options?.allowMultiple !== true"
              class="form-input"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @change="updateFieldValue(field.id, $event.target.value)"
            >
              <option value="">Select a person...</option>
              <option v-for="choice in getFieldChoices(field)" :key="choice.value" :value="choice.value">
                {{ choice.label }}
              </option>
            </select>
            <select
              v-else-if="field.type === 'MULTI_SELECT' || field.type === 'PERSON'"
              class="form-input form-input--multi"
              multiple
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @change="updateMultiSelectValue(field.id, $event)"
            >
              <option v-for="choice in getFieldChoices(field)" :key="choice.value" :value="choice.value">
                {{ choice.label }}
              </option>
            </select>
            <label v-else-if="field.type === 'CHECKBOX'" class="form-checkbox">
              <input
                type="checkbox"
                :checked="valueForField(field)"
                :disabled="field.readOnly"
                @change="updateFieldValue(field.id, $event.target.checked)"
              />
              <span>Yes</span>
            </label>
            <input
              v-else
              class="form-input"
              type="text"
              :placeholder="fieldPlaceholder(field)"
              :value="valueForField(field)"
              :disabled="field.readOnly"
              @input="updateFieldValue(field.id, $event.target.value)"
            />
            <!-- A relation's options loading, or failing to (apart from the inputs above, or a second input shows) -->
            <div v-if="field.type === 'RELATION' && relationOptionsLoadingForField(field)" class="form-field__note muted">
              Loading relation options...
            </div>
            <div
              v-else-if="field.type === 'RELATION' && relationOptionsErrorForField(field)"
              class="form-field__note alert"
            >
              {{ relationOptionsErrorForField(field) }}
            </div>
            <div
              v-else-if="field.type === 'SELECT' && field.selectSource?.type === 'relation' && selectSourceLoadingForField(field)"
              class="form-field__note muted"
            >
              Loading relation options...
            </div>
            <div
              v-else-if="field.type === 'SELECT' && field.selectSource?.type === 'relation' && selectSourceErrorForField(field)"
              class="form-field__note alert"
            >
              {{ selectSourceErrorForField(field) }}
            </div>
          </template>
        </div>
        <div v-if="requiresAmendReason" class="form-field">
          <div class="form-field__label-row">
            <label class="form-field__label">Reason for amendment</label>
            <span class="form-field__required" :class="{ 'form-field__required--error': amendReasonError }">Required</span>
          </div>
          <textarea
            class="form-input"
            rows="3"
            :value="amendReason"
            @input="updateAmendReason"
          ></textarea>
        </div>
        <div class="form-page__footer">
          <button
            class="form-submit-btn"
            :class="{
              'form-submit-btn--highlight': submitHighlight,
              'form-submit-btn--ready': requiredComplete,
              'form-submit-btn--blocked': isSubmitBlocked,
              'form-submit-btn--blocked-error': shouldShowBlockedError,
              'form-submit-btn--shake': submitShake,
            }"
            type="submit"
            :disabled="submitting || loading || isPreview"
          >
            {{ isPreview ? 'Preview' : submitting ? 'Submitting...' : 'Submit' }}
          </button>
          <span
            v-if="submitStatus || submitError"
            class="form-page__status"
            :class="{
              'form-page__status--error': !submitStatus && submitError,
              'form-page__status--ghost': !submitStatus && shouldGhostSubmitError,
            }"
          >
            {{ submitStatus || submitError }}
          </span>
        </div>
      </form>
    </div>
  </div>
</template>
