<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api/client';
import { useWorkspaceStore } from '../stores/workspace';
import { useApiMutation } from '../composables/useApiMutation';
import { parseDate, formatDateTime } from '../utils/date-format';

const props = defineProps({
  adminId: {
    type: String,
    required: true,
  },
});

const docs = ref([]);
const lastRefresh = ref(null);
const materializing = ref({});
const workspace = useWorkspaceStore();
const PURGE_CONFIRM_TEXT = 'PURGE ALL DOCUMENTS';
const RESET_CONFIRM_TEXT = 'RESET ALL WORKSPACES';
const GC_CONFIRM_TEXT = 'GC UPLOADS';
const purgeText = ref('');
const purgeResult = ref(null);
const purgePlaceholder = computed(() => `Type "${PURGE_CONFIRM_TEXT}" to confirm`);
const resetText = ref('');
const resetResult = ref(null);
const resetPlaceholder = computed(() => `Type "${RESET_CONFIRM_TEXT}" to confirm`);
const gcText = ref('');
const gcResult = ref(null);
const gcPlaceholder = computed(() => `Type "${GC_CONFIRM_TEXT}" to confirm`);

const isUuid = (value) => /^[0-9a-fA-F-]{36}$/.test(String(value || ''));

const getDocKind = (name) => {
  if (name.includes(':db:')) return 'Database';
  if (name.endsWith(':synced-blocks')) return 'Synced blocks';
  return 'Doc';
};

const canMaterialize = (name) => {
  if (name.includes(':db:')) return false;
  const parts = String(name || '').split(':');
  const pageId = parts[parts.length - 1];
  return isUuid(pageId);
};

const statusFor = (doc) => {
  const updatedAt = parseDate(doc.updatedAt);
  const materializedAt = parseDate(doc.materializedAt);
  const requestedAt = parseDate(doc.materializeRequestedAt);
  if (requestedAt && (!materializedAt || requestedAt > materializedAt)) {
    return { label: 'Requested', tone: 'pending' };
  }
  if (!materializedAt) {
    return { label: 'Never', tone: 'stale' };
  }
  if (updatedAt && materializedAt && updatedAt > materializedAt) {
    return { label: 'Stale', tone: 'stale' };
  }
  return { label: 'OK', tone: 'ok' };
};


const { loading, error, execute: refresh } = useApiMutation(async () => {
  if (!props.adminId) return;
  const data = await api.listCollabDocs({ adminId: props.adminId });
  docs.value = Array.isArray(data) ? data : [];
  lastRefresh.value = new Date();
});

const requestMaterialize = async (docName) => {
  if (!docName || !props.adminId) return;
  if (!canMaterialize(docName)) return;
  materializing.value = { ...materializing.value, [docName]: true };
  try {
    await api.requestCollabMaterialize(docName, { adminId: props.adminId });
    await refresh();
  } catch (err) {
    error.value = err?.message || 'Failed to request materialization';
  } finally {
    const next = { ...materializing.value };
    delete next[docName];
    materializing.value = next;
  }
};

const summary = computed(() => {
  const counts = { total: docs.value.length, ok: 0, stale: 0, pending: 0 };
  docs.value.forEach((doc) => {
    const status = statusFor(doc);
    if (status.tone === 'ok') counts.ok += 1;
    if (status.tone === 'stale') counts.stale += 1;
    if (status.tone === 'pending') counts.pending += 1;
  });
  return counts;
});

const purgeSummary = computed(() => {
  if (!purgeResult.value) return '';
  const { pages, blocks, databases, databaseFields, databaseRows, collabDocs } = purgeResult.value;
  const parts = [
    `${pages || 0} pages`,
    `${blocks || 0} blocks`,
    `${databases || 0} databases`,
    `${databaseFields || 0} fields`,
    `${databaseRows || 0} rows`,
    `${collabDocs || 0} collab docs`,
  ];
  return `Purged ${parts.join(', ')}.`;
});

const canPurge = computed(() => purgeText.value.trim() === PURGE_CONFIRM_TEXT);
const canReset = computed(() => resetText.value.trim() === RESET_CONFIRM_TEXT);
const canGc = computed(() => gcText.value.trim() === GC_CONFIRM_TEXT);

const { loading: purging, error: purgeError, execute: purgeAll } = useApiMutation(async () => {
  purgeResult.value = null;
  const result = await api.purgeCollabDocs({ adminId: props.adminId, confirm: purgeText.value.trim() });
  purgeResult.value = result?.deleted || null;
  purgeText.value = '';
  await refresh();
  await workspace.loadInitial();
});

const resetSummary = computed(() => {
  if (!resetResult.value) return '';
  const deleted = resetResult.value.deleted || {};
  const created = resetResult.value.created || {};
  const deletedParts = [
    `${deleted.pages || 0} pages`,
    `${deleted.blocks || 0} blocks`,
    `${deleted.databases || 0} databases`,
    `${deleted.databaseFields || 0} fields`,
    `${deleted.databaseRows || 0} rows`,
    `${deleted.collabDocs || 0} collab docs`,
    `${deleted.memberships || 0} memberships`,
    `${deleted.workspaces || 0} workspaces`,
  ];
  const createdParts = [
    `${created.users || 0} users`,
    `${created.workspaces || 0} workspaces`,
    `${created.memberships || 0} memberships`,
  ];
  return `Deleted ${deletedParts.join(', ')}. Rebuilt ${createdParts.join(', ')}.`;
});

const { loading: resetting, error: resetError, execute: resetAll } = useApiMutation(async () => {
  resetResult.value = null;
  const result = await api.resetWorkspaces({ adminId: props.adminId, confirm: resetText.value.trim() });
  resetResult.value = result || null;
  resetText.value = '';
  await refresh();
  await workspace.loadInitial();
});

const gcSummary = computed(() => {
  if (!gcResult.value) return '';
  const {
    deletedObjects = 0,
    orphanedObjects = 0,
    referencedObjects = 0,
    totalObjects = 0,
    ignoredObjects = 0,
    skippedObjects = 0,
    stalePageCount = 0,
    errorCount = 0,
  } = gcResult.value || {};
  const parts = [
    `${deletedObjects} deleted`,
    `${orphanedObjects} orphaned`,
    `${referencedObjects} referenced`,
    `${totalObjects} total`,
  ];
  if (ignoredObjects) parts.push(`${ignoredObjects} ignored`);
  if (skippedObjects) parts.push(`${skippedObjects} skipped`);
  if (stalePageCount) parts.push(`${stalePageCount} stale pages`);
  if (errorCount) parts.push(`${errorCount} errors`);
  return `Cleanup complete: ${parts.join(', ')}.`;
});

const { loading: gcRunning, error: gcError, execute: runGc } = useApiMutation(async () => {
  gcResult.value = null;
  const result = await api.gcUploads({ adminId: props.adminId });
  gcResult.value = result || null;
  gcText.value = '';
});

onMounted(refresh);
watch(
  () => props.adminId,
  () => refresh()
);
</script>

<template>
  <div class="collab-admin">
    <div class="collab-admin__header">
      <div>
        <h3>Collab persistence</h3>
        <p class="muted">Track Yjs persistence and materialization activity.</p>
      </div>
      <div class="collab-admin__actions">
        <button class="ghost-btn ghost-btn-background" type="button" @click="refresh" :disabled="loading">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>
    </div>

    <div class="collab-admin__summary">
      <span class="collab-admin__pill">Total: {{ summary.total }}</span>
      <span class="collab-admin__pill">OK: {{ summary.ok }}</span>
      <span class="collab-admin__pill">Stale: {{ summary.stale }}</span>
      <span class="collab-admin__pill">Requested: {{ summary.pending }}</span>
      <span v-if="lastRefresh" class="collab-admin__pill">Last refresh: {{ lastRefresh.toLocaleTimeString() }}</span>
    </div>

    <span v-if="error" class="alert">{{ error }}</span>

    <div class="collab-admin__table-wrap">
      <table class="collab-admin__table">
        <thead>
          <tr>
            <th>Document</th>
            <th>Kind</th>
            <th>Updated</th>
            <th>Materialized</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!docs.length && !loading">
            <td colspan="6" class="muted">No collab docs stored yet.</td>
          </tr>
          <tr v-for="doc in docs" :key="doc.documentName">
            <td class="collab-admin__doc">
              <div class="collab-admin__doc-title">{{ doc.pageTitle || doc.documentName }}</div>
              <div v-if="doc.pageTitle" class="muted collab-admin__doc-meta">{{ doc.documentName }}</div>
            </td>
            <td>{{ getDocKind(doc.documentName) }}</td>
            <td>{{ formatDateTime(doc.updatedAt) }}</td>
            <td>{{ formatDateTime(doc.materializedAt) }}</td>
            <td>
              <span class="collab-admin__status" :class="`collab-admin__status--${statusFor(doc).tone}`">
                {{ statusFor(doc).label }}
              </span>
            </td>
            <td>
              <button
                class="ghost-btn ghost-btn-background collab-admin__action"
                type="button"
                :disabled="materializing[doc.documentName] || !canMaterialize(doc.documentName)"
                @click="requestMaterialize(doc.documentName)"
              >
                {{ materializing[doc.documentName] ? 'Queued...' : 'Materialize' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="collab-admin__danger">
      <h4>Upload cleanup</h4>
      <p class="muted">Scan all pages and delete uploads that are no longer referenced.</p>
      <div class="collab-admin__danger-row">
        <input
          v-model="gcText"
          class="collab-admin__danger-input"
          type="text"
          :placeholder="gcPlaceholder"
        />
        <button
          class="ghost-btn collab-admin__danger-btn"
          type="button"
          :disabled="!canGc || gcRunning"
          @click="runGc"
        >
          {{ gcRunning ? 'Cleaning...' : 'Run cleanup' }}
        </button>
      </div>
      <span v-if="gcError" class="alert">{{ gcError }}</span>
      <p v-if="gcSummary" class="muted">{{ gcSummary }}</p>
    </div>

    <div class="collab-admin__danger">
      <h4>Danger zone</h4>
      <p class="muted">
        This permanently deletes every page (docs + databases), database rows/fields, blocks, and all collab Yjs snapshots. Users and workspaces are
        untouched.
      </p>
      <div class="collab-admin__danger-row">
        <input
          v-model="purgeText"
          class="collab-admin__danger-input"
          type="text"
          :placeholder="purgePlaceholder"
        />
        <button
          class="ghost-btn collab-admin__danger-btn"
          type="button"
          :disabled="!canPurge || purging"
          @click="purgeAll"
        >
          {{ purging ? 'Purging...' : 'Purge all' }}
        </button>
      </div>
      <span v-if="purgeError" class="alert">{{ purgeError }}</span>
      <p v-if="purgeSummary" class="muted">{{ purgeSummary }}</p>
    </div>

    <div class="collab-admin__danger">
      <h4>Workspace reset</h4>
      <p class="muted">
        This deletes every workspace, page, database, block, membership, and collab snapshot, then recreates a personal workspace for each user based
        on their UUID.
      </p>
      <div class="collab-admin__danger-row">
        <input
          v-model="resetText"
          class="collab-admin__danger-input"
          type="text"
          :placeholder="resetPlaceholder"
        />
        <button
          class="ghost-btn collab-admin__danger-btn"
          type="button"
          :disabled="!canReset || resetting"
          @click="resetAll"
        >
          {{ resetting ? 'Resetting...' : 'Reset workspaces' }}
        </button>
      </div>
      <span v-if="resetError" class="alert">{{ resetError }}</span>
      <p v-if="resetSummary" class="muted">{{ resetSummary }}</p>
    </div>
  </div>
</template>
