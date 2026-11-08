<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { api } from '../api/client';
import TiptapEditor from './TiptapEditor.vue';
import { changesStyle, compareVersions, outermost } from '../utils/versionChanges';

// A page's history: its versions newest first, each one shown as it was, and restoring one.
// A version is an editing session (saves a few minutes apart), credited to everyone who edited.
const props = defineProps({
  pageId: { type: String, required: true },
  canRestore: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'restore']);

const versions = ref([]);
const loading = ref(true);
const error = ref('');
const selectedId = ref(null);
const selected = shallowRef(null); // the selected version, with its content
const loadingVersion = ref(false);
const restoring = ref(false);
const previous = shallowRef(null); // the version before the selected one, to show what changed
const showChanges = ref(true);

const versionsById = computed(() => new Map(versions.value.map((version) => [version.id, version])));
const isNewest = computed(() => !!selectedId.value && versions.value[0]?.id === selectedId.value);

const dayFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const formatWhen = (value) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const day = sameDay(date, today) ? 'Today' : sameDay(date, yesterday) ? 'Yesterday' : dayFormat.format(date);
  return `${day}, ${timeFormat.format(date)}`;
};
const editorNames = (version) => {
  const names = (version.editors || []).map((editor) => editor.name || 'A removed user');
  return names.length ? names.join(', ') : 'Unknown';
};
const restoredFrom = (version) => {
  if (!version.restoredFromId) return '';
  const source = versionsById.value.get(version.restoredFromId);
  return source ? `Restored the version from ${formatWhen(source.updatedAt)}` : 'Restored an earlier version';
};

// Versions already loaded, with their content
const loaded = new Map();
const loadVersion = async (versionId) => {
  if (!loaded.has(versionId)) loaded.set(versionId, api.getPageVersion(props.pageId, versionId));
  try {
    return await loaded.get(versionId);
  } catch (err) {
    loaded.delete(versionId);
    throw err;
  }
};

let request = 0;
const select = async (versionId) => {
  if (selectedId.value === versionId) return;
  selectedId.value = versionId;
  loadingVersion.value = true;
  const mine = ++request;
  const index = versions.value.findIndex((version) => version.id === versionId);
  const previousId = versions.value[index + 1]?.id ?? null;
  try {
    const [version, before] = await Promise.all([loadVersion(versionId), previousId ? loadVersion(previousId) : null]);
    if (mine === request) {
      selected.value = version;
      previous.value = before;
    }
  } catch (err) {
    if (mine === request) error.value = err?.message || "Couldn't load that version.";
  } finally {
    if (mine === request) loadingVersion.value = false;
  }
};

// What the selected version changed, from the one before it (the first version has none)
const changes = computed(() => {
  if (!selected.value || !previous.value || selected.value.id !== selectedId.value) return null;
  const result = compareVersions(previous.value.content, selected.value.content);
  // A block inside an added or removed one is marked and counted with it, as one change
  return { ...result, added: outermost(result.added, result.doc), removed: outermost(result.removed, result.doc) };
});
const changeCounts = computed(() => {
  const c = changes.value;
  return c ? { added: c.added.size, changed: c.changed.size, removed: c.removed.size } : null;
});
const titleChange = computed(() => {
  if (!changes.value || previous.value.title === selected.value.title) return '';
  return previous.value.title ? `Renamed from “${previous.value.title}”` : 'Named';
});
const highlighting = computed(() => showChanges.value && !!changes.value);
const shownDoc = computed(() => (highlighting.value ? changes.value.doc : selected.value?.content));
const highlightCss = computed(() => (highlighting.value ? changesStyle('.page-history__doc', changes.value) : ''));

const restore = async () => {
  if (!selectedId.value || restoring.value) return;
  restoring.value = true;
  error.value = '';
  try {
    const { content } = await api.restorePageVersion(props.pageId, selectedId.value);
    emit('restore', content);
    emit('close');
  } catch (err) {
    error.value = err?.message || "Couldn't restore that version.";
    restoring.value = false;
  }
};

const onKeydown = (event) => {
  if (event.key === 'Escape') emit('close');
};

onMounted(async () => {
  window.addEventListener('keydown', onKeydown);
  try {
    versions.value = await api.listPageVersions(props.pageId);
    if (versions.value.length) await select(versions.value[0].id);
  } catch (err) {
    error.value = err?.message || "Couldn't load this page's history.";
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));

const noOp = () => {};
</script>

<template>
  <div class="modal-backdrop page-history-backdrop" @click.self="emit('close')">
    <div class="modal-card page-history" role="dialog" aria-labelledby="page-history-title">
      <header class="page-history__header">
        <h3 id="page-history-title">Page history</h3>
        <button class="ghost-btn page-history__close" type="button" aria-label="Close" @click="emit('close')">×</button>
      </header>
      <p v-if="error" class="alert">{{ error }}</p>
      <div class="page-history__body">
        <section class="page-history__preview" aria-label="Version">
          <p v-if="loading" class="muted">Loading…</p>
          <p v-else-if="!versions.length" class="muted">
            No versions yet. Versions are kept from now on, each time the page is edited.
          </p>
          <template v-else-if="selected && selected.id === selectedId">
            <div class="page-history__changes">
              <template v-if="changeCounts">
                <label class="page-history__toggle">
                  <input v-model="showChanges" type="checkbox" />
                  Show changes
                </label>
                <span class="page-history__legend" :class="{ 'page-history__legend--off': !showChanges }">
                  <span class="page-history__key page-history__key--added">{{ changeCounts.added }} added</span>
                  <span class="page-history__key page-history__key--changed">{{ changeCounts.changed }} changed</span>
                  <span class="page-history__key page-history__key--removed">{{ changeCounts.removed }} removed</span>
                </span>
              </template>
              <span v-else class="muted">The first version: nothing before it to compare with.</span>
            </div>
            <div class="page-history__doc" :class="{ 'page-history__doc--loading': loadingVersion }">
              <component :is="'style'" v-if="highlightCss">{{ highlightCss }}</component>
              <h1 class="page-history__title" :class="{ 'page-history__title--changed': highlighting && titleChange }">{{ selected.title || 'Untitled' }}</h1>
              <p v-if="highlighting && titleChange" class="page-history__renamed">{{ titleChange }}</p>
              <TiptapEditor :key="`${selected.id}:${highlighting}`" :doc="shownDoc" :readonly="true" :request-delete-confirmation="noOp" />
            </div>
          </template>
        </section>
        <aside class="page-history__list" aria-label="Versions">
          <button
            v-for="(version, index) in versions"
            :key="version.id"
            type="button"
            class="page-history__item"
            :class="{ 'page-history__item--selected': version.id === selectedId }"
            :aria-pressed="version.id === selectedId ? 'true' : 'false'"
            @click="select(version.id)"
          >
            <span class="page-history__when">
              {{ formatWhen(version.updatedAt) }}
              <span v-if="index === 0" class="page-history__current">Current</span>
            </span>
            <span class="page-history__who">{{ editorNames(version) }}</span>
            <span v-if="version.restoredFromId" class="page-history__note">{{ restoredFrom(version) }}</span>
          </button>
        </aside>
      </div>
      <footer v-if="versions.length" class="modal-actions page-history__actions">
        <span v-if="isNewest" class="muted">This is how the page is now.</span>
        <button class="ghost-btn" type="button" @click="emit('close')">Close</button>
        <button
          v-if="canRestore"
          class="ghost-btn ghost-btn-background"
          type="button"
          :disabled="!selected || isNewest || restoring"
          @click="restore"
        >
          {{ restoring ? 'Restoring…' : 'Restore this version' }}
        </button>
      </footer>
    </div>
  </div>
</template>
