import { computed, ref } from 'vue';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { ROW_ID_COLUMN_ID } from '../utils/database/columnLayout';
import { clearYMap, getEntryValue, hydrateRow, readCollabOrder, toPlainValue } from '../utils/database/collabRows';
import { normalizeFieldOptions } from '../utils/database/fieldOptions';

// A database's live-editing document: fields and rows kept in Yjs maps shared through the collab
// server, seeded from the stored database the first time, and applied back to the table as they change.
export function useDatabaseCollab({ props, workspace, fields, rows, sorting, columnSizing, tableWrapRef, lastLoadedSnapshot, isComplianceDatabase, syncComplianceStatusCache }) {
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
  const createCollabDoc = () => {
    const guid = collabContext.value?.docName || `wikid-db-${Math.random().toString(16).slice(2)}`;
    return new Y.Doc({ guid });
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
  // Writes made before the document has synced with the server go into a local copy that doesn't
  // have the server's rows yet: creating a row's map there would compete with the server's map for
  // the same row, and Yjs keeps only one of them, dropping the other's values for everyone. So
  // these wait until the document has synced (writesAfterSync below).
  const syncCollabRowsFromSnapshot = (snapshot) => {
    if (!collabSynced.value) return;
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
    if (!collabSynced.value) return;
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
    writesAfterSync.splice(0).forEach((write) => write());
    scheduleCollabApply();
  };
  // Runs a write to the document now if it has synced, or as soon as it has (see above).
  const writesAfterSync = [];
  const whenCollabSynced = (write) => {
    if (collabSynced.value) write();
    else writesAfterSync.push(write);
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

  return { collabDoc, whenCollabSynced, collabProvider, collabFieldOrder, collabFieldsMap, collabRowOrder, collabRowsMap, ensureCollabDoc, ensureCollabFieldMap, ensureCollabRowMap, isCollabEnabled, maybeSeedCollab, setupCollabProvider, teardownCollabProvider, syncCollabFieldsFromSnapshot, syncCollabRowsFromSnapshot, collabContext };
}

