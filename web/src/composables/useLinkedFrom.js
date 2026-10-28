import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api/client';
import { getLinkedFromConfig, isLinkedFromField } from '../utils/database/fieldOptions';

// Shortly after a change, so a burst of them loads once
const RELOAD_DELAY_MS = 300;

// "Linked from" columns: for each, which rows of another database link to this one's rows (through
// the relation it follows). Loaded from the API, and loaded again when that database changes (the
// collab server says so on the workspace's events channel) or the tab is looked at again.
export function useLinkedFrom({ pageId, fields, workspace }) {
  // fieldId -> { [rowId]: [{ rowId, rowPageId, title }] }
  const linkedRows = ref({});
  // The relations elsewhere that point at this database, for choosing what a column follows
  const incomingRelations = ref([]);
  const incomingRelationsLoading = ref(false);

  const user = () => ({ userId: workspace.activeUser?.id, userName: workspace.activeUser?.name });
  const linkedFields = computed(() =>
    (fields.value || []).filter(isLinkedFromField).map((field) => ({ id: field.id, config: getLinkedFromConfig(field) }))
  );

  const latestRequest = {};
  const load = async ({ id, config }) => {
    const request = (latestRequest[id] || 0) + 1;
    latestRequest[id] = request;
    let rows = {};
    if (config && pageId.value && workspace.hasApi && workspace.activeUser) {
      try {
        rows = (await api.getLinkedRows(pageId.value, { sourcePageId: config.pageId, fieldId: config.fieldId, ...user() }))?.rows || {};
      } catch (err) {
        console.warn('Loading linked rows failed', err);
      }
    }
    // Only the latest answer counts, if the column changed meanwhile
    if (latestRequest[id] !== request) return;
    linkedRows.value = { ...linkedRows.value, [id]: rows };
  };

  let reloadTimer = null;
  const reloadSoon = (entries = linkedFields.value) => {
    clearTimeout(reloadTimer);
    if (!entries.length) return;
    reloadTimer = setTimeout(() => entries.forEach(load), RELOAD_DELAY_MS);
  };

  // A column added, or set to follow another relation
  watch(
    () => linkedFields.value.map(({ id, config }) => `${id}:${config?.pageId}:${config?.fieldId}`).join('|'),
    () => linkedFields.value.forEach(load),
    { immediate: true }
  );
  // A database one of them follows changed
  watch(
    () => linkedFields.value.map(({ config }) => (config && workspace.databaseChangedAt?.[config.pageId]) || 0),
    (next, previous = []) => reloadSoon(linkedFields.value.filter((_, index) => next[index] !== previous[index]))
  );
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') reloadSoon();
  };
  onMounted(() => document.addEventListener('visibilitychange', handleVisibility));
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibility);
    clearTimeout(reloadTimer);
  });

  const linkedRowsFor = (fieldId, rowId) => linkedRows.value[fieldId]?.[rowId] || [];

  const loadIncomingRelations = async () => {
    if (!pageId.value || !workspace.hasApi || !workspace.activeUser) return [];
    incomingRelationsLoading.value = true;
    try {
      incomingRelations.value = (await api.listIncomingRelations(pageId.value, user()))?.relations || [];
    } catch (err) {
      console.warn('Loading relations to this database failed', err);
      incomingRelations.value = [];
    } finally {
      incomingRelationsLoading.value = false;
    }
    return incomingRelations.value;
  };

  return { linkedRowsFor, incomingRelations, incomingRelationsLoading, loadIncomingRelations };
}
