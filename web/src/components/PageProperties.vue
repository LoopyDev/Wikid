<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as Y from 'yjs';
import { createCollabProvider } from '../services/collabSocket';
import { api } from '../api/client';
import { formatDateTime } from '../utils/date-format';
import { useWorkspaceStore } from '../stores/workspace';
import { useApiMutation } from '../composables/useApiMutation';

const props = defineProps({
  pageId: {
    type: String,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
});

const workspace = useWorkspaceStore();
const fields = ref([]);
const row = ref(null);
const rowSaveTimer = ref(null);
const rowSaveStarted = ref(null);
const membersLoading = ref(false);
const membersLoadedFor = ref(null);
const workspaceMembers = ref([]);
const multiSelectMenu = ref({ open: false, fieldId: null, x: 0, y: 0 });
const multiSelectMenuRef = ref(null);
const collabDoc = ref(null);
const collabProvider = ref(null);
const collabFieldsMap = ref(null);
const collabRowsMap = ref(null);
const collabFieldOrder = ref(null);
const collabRowOrder = ref(null);
const collabObserver = ref(null);
const collabApplyScheduled = ref(false);
const collabSynced = ref(false);
const collabSeeded = ref(false);
const currentCollabDocName = ref(null);
const lastLoadedSnapshot = ref(null);
const relationOptionsByPageId = ref({});
const relationOptionsLoading = ref({});
const relationOptionsError = ref({});
const backlinks = ref([]);
const backlinksLoading = ref(false);
const backlinksError = ref('');
const backlinksRequestId = ref(0);

const activeUser = computed(() => workspace.activeUser);
const hasApi = computed(() => workspace.hasApi);
const canEnsureBacklinkPages = computed(() => workspace.canEditActiveWorkspace && !props.readonly);
const pageEntry = computed(() => workspace.pages.find((item) => item.id === props.pageId) || null);
const workspaceId = computed(() => pageEntry.value?.workspaceId || workspace.activeWorkspaceId || null);
const databasePageId = computed(() => {
  const page = pageEntry.value;
  if (!page) return null;
  if (page.kind === 'DATABASE') return null;
  if (page.wikiHomeId && page.wikiHomeId === page.id) return null;
  const parent = page.parentId ? workspace.pages.find((item) => item.id === page.parentId) : null;
  if (parent?.kind === 'DATABASE') return parent.id;
  if (page.wikiHomeId) {
    const wikiHome = workspace.pages.find((item) => item.id === page.wikiHomeId);
    const config = wikiHome?.wikiConfig;
    const candidate = config && typeof config === 'object' && !Array.isArray(config) ? config.databasePageId : null;
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
  }
  return null;
});
const collabContext = computed(() => {
  if (!workspace.collabToken || !workspace.collabUrl) return null;
  if (!databasePageId.value || !workspaceId.value) return null;
  return { docName: `ws:${workspaceId.value}:db:${databasePageId.value}`, token: workspace.collabToken, url: workspace.collabUrl };
});
const isCollabEnabled = computed(() => !!collabContext.value);
const openRowPageOverlay = inject('openRowPageOverlay', null);

const normalizeFieldOptions = (field) => {
  const options = field?.options && typeof field.options === 'object' && !Array.isArray(field.options) ? field.options : {};
  const rawChoices = Array.isArray(options.choices) ? options.choices : [];
  const choices = rawChoices
    .map((choice) => {
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
    })
    .filter(Boolean);
  return { ...options, choices };
};

const cloneForSeed = (value) => JSON.parse(JSON.stringify(value));

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

const getFieldSource = (field) => normalizeFieldOptions(field).source || null;
const isMembersField = (field) => getFieldSource(field) === 'members';
const isPageField = (field) => getFieldSource(field) === 'page';
const isLastEditedField = (field) => getFieldSource(field) === 'lastEdited';
const isFieldReadOnly = (field) => {
  const options = normalizeFieldOptions(field);
  if (options.source === 'lastEdited') return true;
  if (options.source === 'page') return !!options.readonly;
  return !!options.readonly;
};

const memberChoiceList = computed(() =>
  workspaceMembers.value.map((member) => ({
    value: member.id,
    label: member.name,
  }))
);
const membersMap = computed(() => new Map(workspaceMembers.value.map((member) => [member.id, member.name])));

const getFieldChoices = (field) => {
  if (isMembersField(field)) {
    return memberChoiceList.value;
  }
  return normalizeFieldOptions(field).choices;
};

const getChoiceLabel = (field, value) => {
  if (!value) return '';
  const choices = getFieldChoices(field);
  const match = choices.find((choice) => choice.value === value);
  if (match?.label) return match.label;
  if (isMembersField(field)) {
    return membersMap.value.get(value) || value;
  }
  return match?.value || String(value);
};

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

const stringifyValue = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const label = value.label ?? value.id;
    if (label !== undefined && label !== null && String(label).trim()) {
      return String(label);
    }
  }
  if (value === null || value === undefined) return '';
  return String(value);
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

const relationOptionsForField = (field) => {
  const relation = getRelationConfig(field);
  if (!relation?.pageId) return [];
  return relationOptionsByPageId.value[relation.pageId] || [];
};

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

const loadRelationOptions = async (pageId, { force = false } = {}) => {
  if (!pageId) return;
  if (!activeUser.value || !hasApi.value) return;
  if (!force && relationOptionsByPageId.value[pageId]) return;
  if (relationOptionsLoading.value[pageId]) return;
  relationOptionsLoading.value = { ...relationOptionsLoading.value, [pageId]: true };
  relationOptionsError.value = { ...relationOptionsError.value, [pageId]: '' };
  try {
    const user = { userId: activeUser.value.id, userName: activeUser.value.name };
    // The rows' current names, from the live document (the saved rows can be a few minutes behind)
    const live = await api.getRowTitles(pageId, user).catch(() => null);
    if (Array.isArray(live?.rows)) {
      const options = live.rows.filter((row) => row?.id).map((row) => ({ id: row.id, label: row.title || String(row.id), pageId: row.pageId || null, color: row.color || null }));
      relationOptionsByPageId.value = { ...relationOptionsByPageId.value, [pageId]: options };
      return;
    }
    const res = await api.getDatabase(pageId, user);
    const targetFields = Array.isArray(res?.fields) ? res.fields : [];
    const targetRows = Array.isArray(res?.rows) ? res.rows : [];
    const titleFieldId =
      targetFields.find((entry) => getFieldSource(entry) === 'page')?.id || targetFields[0]?.id || null;
    const options = targetRows
      .map((rowEntry) => {
        const data = rowEntry?.data && typeof rowEntry.data === 'object' && !Array.isArray(rowEntry.data) ? rowEntry.data : {};
        const label = titleFieldId ? stringifyValue(data[titleFieldId]) : '';
        const fallback = label || (rowEntry?.id ? String(rowEntry.id) : '');
        // The row's own page, if it has one, for opening it from a relation's pill
        return rowEntry?.id ? { id: rowEntry.id, label: fallback, pageId: rowEntry.pageId || null } : null;
      })
      .filter(Boolean);
    relationOptionsByPageId.value = { ...relationOptionsByPageId.value, [pageId]: options };
  } catch (err) {
    console.warn('Load relation options failed', err);
    relationOptionsError.value = { ...relationOptionsError.value, [pageId]: err?.message || 'Failed to load relations' };
  } finally {
    relationOptionsLoading.value = { ...relationOptionsLoading.value, [pageId]: false };
  }
};

// When a database these relations point at changes (renamed rows, say), load its names again
watch(
  () => (fields.value || []).map((field) => getRelationConfig(field)?.pageId).filter(Boolean).map((pageId) => `${pageId}:${workspace.databaseChangedAt?.[pageId] || 0}`),
  (next, previous = []) => {
    next.forEach((entry) => {
      const [pageId, changedAt] = entry.split(':');
      if (changedAt !== '0' && !previous.includes(entry) && relationOptionsByPageId.value[pageId]) {
        void loadRelationOptions(pageId, { force: true });
      }
    });
  }
);

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

const resolveRelationLabel = (field, entry) => {
  if (!entry) return '';
  if (entry.label) return entry.label;
  const options = relationOptionsForField(field);
  const match = options.find((option) => option.id === entry.id);
  return match?.label || entry.id || '';
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

const choiceColorForValue = (field, value) => {
  if (!field || !value) return null;
  const choices = getFieldChoices(field);
  const match = choices.find((choice) => choice.value === value);
  return match?.color || null;
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
  const nextFields = buildFieldsFromCollab();
  if (nextFields.length) {
    fields.value = nextFields;
  }
  const nextRows = buildRowsFromCollab();
  const nextRow = nextRows.find((item) => item.pageId === props.pageId) || null;
  if (nextRow) {
    row.value = nextRow;
  }
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
    snapshot.rows.forEach((item) => {
      if (!item?.id) return;
      const rowMap = new Y.Map();
      const dataMap = new Y.Map();
      const data = item?.data && typeof item.data === 'object' ? item.data : {};
      Object.entries(data).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
      rowMap.set('data', dataMap);
      if (item?.pageId) {
        rowMap.set('pageId', item.pageId);
      }
      collabRowsMap.value.set(item.id, rowMap);
      collabRowOrder.value.push([item.id]);
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

// Like the table (useDatabaseCollab.js), this waits for the document to sync before writing to it:
// a row's map created in the unsynced local copy would compete with the server's map for the same
// row, and Yjs would keep only one of them.
const syncCollabRowsFromSnapshot = (snapshot) => {
  if (!collabSynced.value) return;
  if (!snapshot?.rows?.length) return;
  if (!isCollabEnabled.value || !collabDoc.value) return;
  if (!collabRowsMap.value || !collabRowOrder.value) return;
  const rowsMap = collabRowsMap.value;
  const rowOrder = collabRowOrder.value;
  const existingOrder = new Set(readCollabOrder(rowOrder));
  collabDoc.value.transact(() => {
    snapshot.rows.forEach((item) => {
      if (!item?.id) return;
      const existing = rowsMap.get(item.id);
      if (existing instanceof Y.Map) {
        if (item.pageId && !existing.get('pageId')) {
          existing.set('pageId', item.pageId);
        }
        if (!existingOrder.has(item.id)) {
          rowOrder.push([item.id]);
          existingOrder.add(item.id);
        }
        return;
      }
      const rowMap = new Y.Map();
      const dataMap = new Y.Map();
      const data = item?.data && typeof item.data === 'object' ? item.data : {};
      Object.entries(data).forEach(([key, value]) => {
        dataMap.set(key, value);
      });
      rowMap.set('data', dataMap);
      if (item?.pageId) {
        rowMap.set('pageId', item.pageId);
      }
      rowsMap.set(item.id, rowMap);
      rowOrder.push([item.id]);
      existingOrder.add(item.id);
    });
  }, 'db-row-sync');
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
  const rowOrder = collabRowOrder.value || doc.getArray('rowOrder');
  collabRowOrder.value = rowOrder;
  const order = readCollabOrder(rowOrder);
  if (!order.includes(rowId)) {
    rowOrder.push([rowId]);
  }
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

const handleCollabSynced = (synced) => {
  if (!synced) return;
  collabSynced.value = true;
  maybeSeedCollab();
  syncCollabRowsFromSnapshot(lastLoadedSnapshot.value);
  writesAfterSync.splice(0).forEach((write) => write());
  scheduleCollabApply();
};

// Runs a write to the document now if it has synced, or as soon as it has.
const writesAfterSync = [];
const whenCollabSynced = (write) => {
  if (collabSynced.value) write();
  else writesAfterSync.push(write);
};

const ensureCollabProvider = () => {
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
  if (collabProvider.value && currentCollabDocName.value === docName) return;
  try {
    collabProvider.value = createCollabProvider({
      url: ctx.url,
      name: ctx.docName,
      token: () => collabContext.value?.token,
      document: collabDoc.value,
    });
    collabProvider.value.on('synced', handleCollabSynced);
  } catch (err) {
    console.warn('Properties collab provider failed to initialize', err);
    teardownCollabProvider({ keepDoc: true });
  }
};

const properties = computed(() => fields.value.filter((field) => !isPageField(field)));
const hasProperties = computed(() => !!row.value && properties.value.length > 0);
const hasBacklinks = computed(() => backlinks.value.length > 0);
const showPanel = computed(
  () =>
    loading.value ||
    !!error.value ||
    !!row.value ||
    hasProperties.value ||
    backlinksLoading.value ||
    !!backlinksError.value ||
    hasBacklinks.value
);

const hydrateRow = (value) => ({
  ...value,
  data: value?.data && typeof value.data === 'object' ? { ...value.data } : {},
});

const getMultiSelectValues = (dataValue) => {
  if (Array.isArray(dataValue)) {
    return dataValue.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof dataValue === 'string') {
    return dataValue
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const getRelationMultiValues = (dataValue) => {
  const entries = Array.isArray(dataValue) ? dataValue : [dataValue];
  return entries.map((entry) => normalizeRelationEntry(entry)?.id).filter(Boolean);
};

const normalizeCellValue = (field, value) => {
  if (!field) return value ?? '';
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (!relation) return null;
    const normalizeValue = (entryValue) => {
      const entry = normalizeRelationEntry(entryValue);
      if (!entry) return null;
      return { id: entry.id, label: resolveRelationLabel(field, entry) };
    };
    if (relation.allowMultiple) {
      const list = Array.isArray(value) ? value : [value];
      const entries = list.map((item) => normalizeValue(item)).filter(Boolean);
      return entries.length ? entries : null;
    }
    return normalizeValue(value);
  }
  if (field.type === 'MULTI_SELECT') {
    if (Array.isArray(value)) {
      const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
      return cleaned.length ? cleaned : null;
    }
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (field.type === 'CHECKBOX') {
    return !!value;
  }
  if (field.type === 'NUMBER') {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  if (field.type === 'DATE') {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed : null;
  }
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
};

const shouldClearCell = (value) => value === null || value === '' || (Array.isArray(value) && value.length === 0);


const resolveRowLastEdited = () => {
  const rowUpdated = row.value?.updatedAt ? new Date(row.value.updatedAt) : null;
  const pageUpdated = pageEntry.value?.updatedAt ? new Date(pageEntry.value.updatedAt) : null;
  const rowValid = rowUpdated && !Number.isNaN(rowUpdated.getTime()) ? rowUpdated : null;
  const pageValid = pageUpdated && !Number.isNaN(pageUpdated.getTime()) ? pageUpdated : null;
  if (rowValid && pageValid) {
    return pageValid > rowValid ? pageValid : rowValid;
  }
  return rowValid || pageValid || null;
};

const displayValue = (field) => {
  if (!row.value || !field) return '';
  if (isLastEditedField(field)) {
    return formatDateTime(resolveRowLastEdited());
  }
  const value = row.value?.data?.[field.id];
  if (field.type === 'MULTI_SELECT') {
    const values = getMultiSelectValues(value);
    return values.map((entry) => {
      const choices = getFieldChoices(field);
      const match = choices.find((choice) => choice.value === entry);
      if (match?.label) return match.label;
      if (isMembersField(field)) return membersMap.value.get(entry) || entry;
      return entry;
    }).join(', ');
  }
  if (field.type === 'SELECT') {
    const choices = getFieldChoices(field);
    const match = choices.find((choice) => choice.value === value);
    if (match?.label) return match.label;
    if (isMembersField(field)) return membersMap.value.get(value) || value || '';
  }
  if (field.type === 'RELATION') {
    const relation = getRelationConfig(field);
    if (relation?.allowMultiple) {
      const entries = Array.isArray(value) ? value : [value];
      return entries
        .map((entry) => {
          const normalized = normalizeRelationEntry(entry);
          return normalized ? resolveRelationLabel(field, normalized) : '';
        })
        .filter(Boolean)
        .join(', ');
    }
    const entry = normalizeRelationEntry(value);
    return entry ? resolveRelationLabel(field, entry) : '';
  }
  return value ?? '';
};

const notifyRowUpdated = (nextRow) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('wikid:db-row-updated', {
      detail: {
        databasePageId: databasePageId.value,
        rowId: nextRow?.id,
        data: nextRow?.data && typeof nextRow.data === 'object' ? { ...nextRow.data } : {},
      },
    })
  );
};

const updateRowData = (nextData) => {
  if (!row.value) return;
  row.value = { ...row.value, data: nextData };
  notifyRowUpdated(row.value);
};

const scheduleRowUpdate = (nextData) => {
  if (!row.value || !hasApi.value || !activeUser.value || props.readonly) return;
  if (rowSaveTimer.value) {
    clearTimeout(rowSaveTimer.value);
  }
  const started = rowSaveStarted.value || workspace.beginSaving();
  rowSaveStarted.value = started;
  rowSaveTimer.value = setTimeout(async () => {
    rowSaveTimer.value = null;
    try {
      const res = await api.updateDatabaseRow(
        row.value.id,
        { data: nextData },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      );
      const payload = res && res.row ? res : { row: res };
      const nextRow = payload?.row;
      if (nextRow) {
        row.value = hydrateRow({ ...row.value, ...nextRow });
      }
      if (payload?.page) {
        workspace.upsertPage(payload.page);
      }
      notifyRowUpdated(row.value);
    } catch (err) {
      console.warn('Update row failed', err);
    } finally {
      workspace.finishSaving(started);
      rowSaveStarted.value = null;
    }
  }, 300);
};

const handleFieldChange = (field, rawValue) => {
  if (props.readonly || isFieldReadOnly(field)) return;
  if (!row.value) return;
  const value = normalizeCellValue(field, rawValue);
  const data = row.value?.data && typeof row.value.data === 'object' ? { ...row.value.data } : {};
  if (shouldClearCell(value)) {
    delete data[field.id];
  } else {
    data[field.id] = value;
  }
  updateRowData(data);
  if (isCollabEnabled.value) {
    const rowId = row.value?.id;
    const fieldId = field?.id;
    if (!rowId || !fieldId) return;
    const pageId = row.value?.pageId;
    whenCollabSynced(() => {
      const rowMap = ensureCollabRowMap(rowId);
      const dataMap = ensureCollabRowDataMap(rowMap);
      if (!rowMap || !dataMap) return;
      ensureCollabDoc().transact(() => {
        if (shouldClearCell(value)) {
          dataMap.delete(fieldId);
        } else {
          dataMap.set(fieldId, value);
        }
        if (pageId && !rowMap.get('pageId')) {
          rowMap.set('pageId', pageId);
        }
      }, 'db-cell-update');
    });
    return;
  }
  scheduleRowUpdate(data);
};

const loadBacklinks = async () => {
  backlinksError.value = '';
  const rowId = row.value?.id;
  const requestId = backlinksRequestId.value + 1;
  backlinksRequestId.value = requestId;
  if (!rowId || !hasApi.value || !activeUser.value) {
    backlinks.value = [];
    backlinksLoading.value = false;
    return;
  }
  backlinksLoading.value = true;
  try {
    const res = await api.getDatabaseRowBacklinks(rowId, {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    if (backlinksRequestId.value !== requestId) return;
    backlinks.value = Array.isArray(res?.backlinks) ? res.backlinks : [];
  } catch (err) {
    if (backlinksRequestId.value !== requestId) return;
    backlinks.value = [];
    backlinksError.value = err?.message || 'Failed to load backlinks';
  } finally {
    if (backlinksRequestId.value === requestId) {
      backlinksLoading.value = false;
    }
  }
};

const openBacklink = async (entry) => {
  if (!entry) return;
  const targetRowId = typeof entry.rowId === 'string' ? entry.rowId : '';
  if (!targetRowId) return;
  const existingPageId = typeof entry.rowPageId === 'string' ? entry.rowPageId : '';
  if (existingPageId && typeof openRowPageOverlay === 'function') {
    openRowPageOverlay(existingPageId);
    return;
  }
  if (!canEnsureBacklinkPages.value || !activeUser.value || !hasApi.value) return;
  try {
    const title = typeof entry.rowTitle === 'string' ? entry.rowTitle.trim() : '';
    const res = await api.ensureDatabaseRowPage(
      targetRowId,
      { title: title || 'Record' },
      { userId: activeUser.value.id, userName: activeUser.value.name }
    );
    const page = res?.page || null;
    const pageId = page?.id || res?.pageId || '';
    if (page) {
      workspace.upsertPage(page);
    }
    if (!pageId) return;
    backlinks.value = backlinks.value.map((item) =>
      item.rowId === entry.rowId && item.fieldId === entry.fieldId ? { ...item, rowPageId: pageId } : item
    );
    if (typeof openRowPageOverlay === 'function') {
      openRowPageOverlay(pageId);
    }
  } catch (err) {
    console.warn('Open backlink failed', err);
  }
};

// A relation's values as pills that open the linked rows; its dropdown shows only while choosing
const choosingRelationFieldId = ref(null);
const relationEntriesFor = (field) => {
  const raw = row.value?.data?.[field.id];
  const ids = getRelationConfig(field)?.allowMultiple
    ? getRelationMultiValues(raw)
    : [normalizeRelationEntry(raw)?.id].filter(Boolean);
  const options = relationOptionsForField(field);
  return ids.map((id) => {
    const option = options.find((entry) => entry.id === id);
    return { id, label: option?.label || id, color: option?.color || null };
  });
};
const chooseRelation = async (field) => {
  choosingRelationFieldId.value = field.id;
  await nextTick();
  document.querySelector(`[data-relation-select="${field.id}"]`)?.focus();
};
const openRelatedRecord = async (field, entry) => {
  const relation = getRelationConfig(field);
  const option = relationOptionsForField(field).find((item) => item.id === entry.id);
  let pageId = option?.pageId || '';
  if (!pageId) {
    if (!canEnsureBacklinkPages.value || !activeUser.value || !hasApi.value) return;
    try {
      const res = await api.ensureDatabaseRowPage(
        entry.id,
        { title: entry.label || 'Record', pageId: relation?.pageId },
        { userId: activeUser.value.id, userName: activeUser.value.name }
      );
      const page = res?.page || null;
      pageId = page?.id || res?.row?.pageId || '';
      if (page) workspace.upsertPage(page);
      if (option && pageId) option.pageId = pageId;
    } catch (err) {
      console.warn('Opening the linked row failed', err);
      return;
    }
  }
  if (pageId && typeof openRowPageOverlay === 'function') openRowPageOverlay(pageId);
};

const handleRelationSelectChange = (field, event) => {
  const relation = getRelationConfig(field);
  const target = event?.target;
  if (relation?.allowMultiple) {
    const selected = Array.from(target?.selectedOptions || []).map((option) => option.value).filter(Boolean);
    handleFieldChange(field, selected);
    return;
  }
  handleFieldChange(field, target?.value ?? '');
};

const multiSelectValuesForField = (field) => {
  if (!row.value || !field) return [];
  return getMultiSelectValues(row.value?.data?.[field.id]);
};

const closeMultiSelectMenu = () => {
  multiSelectMenu.value = { open: false, fieldId: null, x: 0, y: 0 };
};

const openMultiSelectMenu = (field, event) => {
  if (!field || field.type !== 'MULTI_SELECT') return;
  if (props.readonly || isFieldReadOnly(field)) return;
  if (!event) return;
  const isSame = multiSelectMenu.value.open && multiSelectMenu.value.fieldId === field.id;
  if (isSame) {
    closeMultiSelectMenu();
    return;
  }
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
  multiSelectMenu.value = { open: true, fieldId: field.id, x, y };
};

const isMultiSelectOptionSelected = (value) => activeMultiSelectValues.value.includes(value);

const toggleMultiSelectOption = (value) => {
  if (!activeMultiSelectField.value || !row.value || !value) return;
  const field = activeMultiSelectField.value;
  const current = new Set(getMultiSelectValues(row.value?.data?.[field.id]));
  if (current.has(value)) {
    current.delete(value);
  } else {
    current.add(value);
  }
  const choices = getFieldChoices(field);
  const ordered = choices.map((choice) => choice.value).filter((choiceValue) => current.has(choiceValue));
  const extras = [...current].filter((choiceValue) => !choices.some((choice) => choice.value === choiceValue));
  const next = [...ordered, ...extras];
  handleFieldChange(field, next);
};

const handleMenuOutsideClick = (event) => {
  if (!multiSelectMenu.value.open) return;
  const target = event?.target;
  if (target?.closest?.('.db-multi-cell')) return;
  if (multiSelectMenuRef.value?.contains(target)) return;
  closeMultiSelectMenu();
};

const handleMenuKeydown = (event) => {
  if (!multiSelectMenu.value.open) return;
  if (event.key === 'Escape') {
    closeMultiSelectMenu();
  }
};

const loadMembers = async () => {
  const workspaceId = pageEntry.value?.workspaceId || workspace.activeWorkspaceId;
  if (!workspaceId || !hasApi.value || !activeUser.value) return;
  if (membersLoadedFor.value === workspaceId) return;
  membersLoading.value = true;
  try {
    const res = await api.listWorkspaceMembers(workspaceId, { userId: activeUser.value.id });
    const list = Array.isArray(res)
      ? res.map((entry) => ({
          id: entry?.user?.id || entry?.userId || entry?.id,
          name: entry?.user?.displayName || entry?.user?.email || entry?.userId || 'Member',
        }))
      : [];
    workspaceMembers.value = list.filter((member) => member.id);
    membersLoadedFor.value = workspaceId;
  } catch (err) {
    console.warn('Load members failed', err);
  } finally {
    membersLoading.value = false;
  }
};

const needsMembers = computed(() => fields.value.some((field) => isMembersField(field)));
const activeMultiSelectField = computed(() => {
  if (!multiSelectMenu.value.fieldId) return null;
  return fields.value.find((field) => field.id === multiSelectMenu.value.fieldId) || null;
});
const activeMultiSelectChoices = computed(() => {
  if (!activeMultiSelectField.value) return [];
  return getFieldChoices(activeMultiSelectField.value) || [];
});
const activeMultiSelectValues = computed(() => {
  if (!row.value || !activeMultiSelectField.value) return [];
  return getMultiSelectValues(row.value?.data?.[activeMultiSelectField.value.id]);
});
const multiSelectMenuStyle = computed(() => ({
  left: `${multiSelectMenu.value.x}px`,
  top: `${multiSelectMenu.value.y}px`,
}));
const handleFieldUpdated = (event) => {
  const detail = event?.detail;
  if (!detail || detail.databasePageId !== databasePageId.value) return;
  const incoming = detail.field;
  if (!incoming?.id) return;
  const normalized = { ...incoming, options: normalizeFieldOptions(incoming) };
  if (fields.value.some((field) => field.id === incoming.id)) {
    fields.value = fields.value.map((field) => (field.id === incoming.id ? { ...field, ...normalized } : field));
    return;
  }
  fields.value = [...fields.value, normalized];
};

const { loading, error, execute: loadProperties } = useApiMutation(async () => {
  if (!props.pageId || !databasePageId.value || !hasApi.value || !activeUser.value) {
    fields.value = [];
    row.value = null;
    lastLoadedSnapshot.value = null;
    multiSelectMenu.value = { open: false, fieldId: null, x: 0, y: 0 };
    return;
  }
  fields.value = [];
  row.value = null;
  const res = await api.getDatabase(databasePageId.value, {
    userId: activeUser.value.id,
    userName: activeUser.value.name,
  });
  const nextFields = (res?.fields || []).map((field) => ({
    ...field,
    options: normalizeFieldOptions(field),
  }));
  const nextRows = (res?.rows || []).map(hydrateRow);
  fields.value = nextFields;
  primeRelationOptions(nextFields);
  row.value = nextRows.find((item) => item.pageId === props.pageId) || null;
  lastLoadedSnapshot.value = {
    fields: cloneForSeed(nextFields),
    rows: cloneForSeed(nextRows),
  };
  maybeSeedCollab();
  syncCollabRowsFromSnapshot(lastLoadedSnapshot.value);
  scheduleCollabApply();
});

watch(
  () => [props.pageId, databasePageId.value, activeUser.value?.id],
  () => {
    closeMultiSelectMenu();
    lastLoadedSnapshot.value = null;
    loadProperties();
  },
  { immediate: true }
);

watch(
  () => [row.value?.id, activeUser.value?.id],
  () => {
    backlinks.value = [];
    backlinksError.value = '';
    loadBacklinks();
  },
  { immediate: true }
);

watch(
  () => fields.value.map((field) => `${field.id}:${field.type}:${getRelationConfig(field)?.pageId || ''}`),
  () => {
    primeRelationOptions(fields.value);
  }
);

watch(
  () => needsMembers.value,
  (needs) => {
    if (!needs) return;
    loadMembers();
  }
);

watch(
  () => collabContext.value,
  () => {
    ensureCollabProvider();
  },
  { immediate: true }
);

onMounted(() => {
  document.addEventListener('mousedown', handleMenuOutsideClick, true);
  window.addEventListener('keydown', handleMenuKeydown);
  window.addEventListener('wikid:db-field-updated', handleFieldUpdated);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleMenuOutsideClick, true);
  window.removeEventListener('keydown', handleMenuKeydown);
  window.removeEventListener('wikid:db-field-updated', handleFieldUpdated);
  teardownCollabProvider();
  if (rowSaveTimer.value) {
    clearTimeout(rowSaveTimer.value);
    rowSaveTimer.value = null;
  }
  if (rowSaveStarted.value) {
    workspace.finishSaving(rowSaveStarted.value);
    rowSaveStarted.value = null;
  }
});
</script>

<template>
  <div v-if="showPanel" class="page-properties">
    <div v-if="membersLoading" class="page-properties__header">
      <span class="muted">Loading members...</span>
    </div>
    <div v-if="error" class="alert page-properties__alert">{{ error }}</div>
    <div v-else-if="loading" class="muted page-properties__status">Loading properties...</div>
    <div v-else-if="row && properties.length" class="page-properties__grid">
      <div v-for="field in properties" :key="field.id" class="page-properties__row">
        <span class="page-properties__label">{{ field.name || 'Field' }}</span>
        <div class="page-properties__value">
          <template v-if="isLastEditedField(field)">
            <span class="page-properties__readonly">{{ displayValue(field) || '—' }}</span>
          </template>
          <template v-else-if="field.type === 'CHECKBOX'">
            <input
              class="page-properties__checkbox"
              type="checkbox"
              :checked="!!row.data?.[field.id]"
              :disabled="readonly || isFieldReadOnly(field)"
              @change="handleFieldChange(field, $event.target.checked)"
            />
          </template>
          <template v-else-if="field.type === 'DATE'">
            <input
              class="page-properties__input"
              type="date"
              :value="row.data?.[field.id] || ''"
              :disabled="readonly || isFieldReadOnly(field)"
              @change="handleFieldChange(field, $event.target.value)"
            />
          </template>
          <template v-else-if="field.type === 'RELATION'">
            <div
              v-if="relationEntriesFor(field).length && choosingRelationFieldId !== field.id"
              class="page-properties__relation"
            >
              <button
                v-for="entry in relationEntriesFor(field)"
                :key="entry.id"
                class="db-multi-pill db-relation-pill"
                type="button"
                :title="`Open ${entry.label}`"
                :style="multiSelectPillStyle(entry.color)"
                @click="openRelatedRecord(field, entry)"
              >
                {{ entry.label }}
              </button>
              <button
                v-if="!readonly && !isFieldReadOnly(field)"
                class="db-relation-change"
                type="button"
                :aria-label="`Change ${field.name || 'relation'}`"
                title="Change"
                @click="chooseRelation(field)"
              >
                ▾
              </button>
            </div>
            <template v-else>
            <select
              v-if="getRelationConfig(field)?.allowMultiple"
              class="page-properties__input"
              multiple
              :data-relation-select="field.id"
              :value="getRelationMultiValues(row.data?.[field.id])"
              :disabled="readonly || isFieldReadOnly(field)"
              @change="handleRelationSelectChange(field, $event)"
              @blur="choosingRelationFieldId = null"
            >
              <option v-for="option in relationOptionsForField(field)" :key="option.id" :value="option.id">
                {{ option.label || option.id }}
              </option>
            </select>
            <select
              v-else
              class="page-properties__input"
              :data-relation-select="field.id"
              :value="normalizeRelationEntry(row.data?.[field.id])?.id || ''"
              :disabled="readonly || isFieldReadOnly(field)"
              @change="handleRelationSelectChange(field, $event); choosingRelationFieldId = null"
              @blur="choosingRelationFieldId = null"
            >
              <option value="">Select record</option>
              <option v-for="option in relationOptionsForField(field)" :key="option.id" :value="option.id">
                {{ option.label || option.id }}
              </option>
            </select>
            </template>
            <div v-if="relationOptionsLoadingForField(field)" class="page-properties__note muted">
              Loading relation options...
            </div>
            <div v-else-if="relationOptionsErrorForField(field)" class="page-properties__note alert">
              {{ relationOptionsErrorForField(field) }}
            </div>
          </template>
          <template v-else-if="field.type === 'SELECT' && getFieldChoices(field).length">
            <select
              class="page-properties__input"
              :value="row.data?.[field.id] || ''"
              :disabled="readonly || isFieldReadOnly(field)"
              @change="handleFieldChange(field, $event.target.value)"
            >
              <option value="">Select</option>
              <option v-for="option in getFieldChoices(field)" :key="option.value" :value="option.value">
                {{ option.label || option.value }}
              </option>
            </select>
          </template>
          <template v-else-if="field.type === 'SELECT'">
            <input
              class="page-properties__input"
              type="text"
              :value="row.data?.[field.id] ?? ''"
              :disabled="readonly || isFieldReadOnly(field)"
              @input="handleFieldChange(field, $event.target.value)"
            />
          </template>
          <template v-else-if="field.type === 'MULTI_SELECT'">
            <button
              class="db-multi-cell page-properties__multi-cell"
              type="button"
              :disabled="readonly || isFieldReadOnly(field)"
              @click="openMultiSelectMenu(field, $event)"
            >
              <template v-if="multiSelectValuesForField(field).length">
                <span
                  v-for="value in multiSelectValuesForField(field)"
                  :key="value"
                  class="db-multi-pill"
                  :style="multiSelectPillStyle(choiceColorForValue(field, value))"
                >
                  {{ getChoiceLabel(field, value) }}
                </span>
              </template>
              <template v-else>
                <span class="db-multi-placeholder">{{ isMembersField(field) ? 'Add person' : 'Add option' }}</span>
              </template>
            </button>
          </template>
          <template v-else>
            <input
              class="page-properties__input"
              :type="field.type === 'URL' ? 'url' : 'text'"
              :value="row.data?.[field.id] ?? ''"
              :disabled="readonly || isFieldReadOnly(field)"
              @input="handleFieldChange(field, $event.target.value)"
            />
          </template>
        </div>
      </div>
    </div>
    <div v-if="row" class="page-properties__backlinks">
      <div class="page-properties__header">
        <span class="page-properties__title">Linked from</span>
        <div class="page-properties__backlinks-actions">
          <button
            class="page-properties__backlinks-refresh"
            type="button"
            :disabled="backlinksLoading"
            @click="loadBacklinks"
          >
            Refresh
          </button>
        </div>
      </div>
      <div v-if="backlinksLoading" class="muted page-properties__status">Loading backlinks...</div>
      <div v-else-if="backlinksError" class="alert page-properties__alert">{{ backlinksError }}</div>
      <div v-else-if="!backlinks.length" class="page-properties__backlinks-empty">No backlinks yet.</div>
      <ul v-else class="page-properties__backlinks-list">
        <li v-for="entry in backlinks" :key="`${entry.rowId}:${entry.fieldId}`">
          <button
            class="page-properties__backlink"
            type="button"
            :disabled="!entry.rowPageId && !canEnsureBacklinkPages"
            @click="openBacklink(entry)"
          >
            <span class="page-properties__backlink-title">{{ entry.rowTitle || 'Record' }}</span>
            <span class="page-properties__backlink-meta">
              {{ entry.databaseTitle || 'Database' }} · {{ entry.fieldName || 'Relation' }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
  <div
    v-if="multiSelectMenu.open && activeMultiSelectField && row"
    ref="multiSelectMenuRef"
    class="block-menu db-multi-select-menu"
    :style="multiSelectMenuStyle"
  >
    <div class="block-menu__panel-stack">
      <div class="block-menu__panel">
        <div class="block-menu__panel-scroll">
          <div
            v-if="membersLoading && isMembersField(activeMultiSelectField)"
            class="db-options-empty"
          >
            Loading members...
          </div>
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
</template>
