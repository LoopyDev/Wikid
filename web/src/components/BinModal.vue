<script setup>
import { computed, ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

// The workspace's rubbish bin: restore pages, or delete them all for good.
// 'restored-parents': ids of pages brought back with a sub-page, so the sidebar can open them
const emit = defineEmits(['close', 'restored-parents']);
const workspace = useWorkspaceStore();

const pageTitle = (page) => page?.title || 'Untitled page';
// A page whose parent is still in the Bin: ask whether to bring the parent back too, or put the page at
// the top level, since under a binned parent it wouldn't show anywhere.
const choosing = ref(null); // { page, parents }
const notice = ref('');
const parentLabel = computed(() => {
  const parents = choosing.value?.parents || [];
  if (!parents.length) return '';
  const first = `"${pageTitle(parents[0])}"`;
  return parents.length > 1 ? `${first} and ${parents.length - 1} more` : first;
});

const restoreFromBin = async (page, placement) => {
  notice.value = '';
  const result = await workspace.restorePageFromBin(page, { placement });
  if (result?.parentsInBin) {
    choosing.value = { page, parents: result.parentsInBin };
    return;
  }
  const parents = choosing.value?.parents || [];
  choosing.value = null;
  if (result?.movedToTopLevel) {
    notice.value = `Restored "${pageTitle(page)}" to the top level, because "${pageTitle(parents[0])}" is still in the Bin.`;
  } else if (result?.restored && placement === 'withParents' && parents.length) {
    emit('restored-parents', parents.map((p) => p.id));
  }
  await workspace.loadBinPages();
};
const destroyBin = async () => {
  if (workspace.binPages.length) {
    await workspace.destroyBin(workspace.binPages.map((p) => p.id));
  }
  emit('close');
};
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card delete-modal-card">
      <h3>Rubbish bin</h3>
      <p class="muted">Recently deleted pages. Restore to bring them back into the workspace.</p>
      <div v-if="choosing" class="bin-choice" role="group" aria-label="Where to restore the page">
        <p>
          <strong>{{ parentLabel }} {{ choosing.parents.length > 1 ? 'are' : 'is' }} still in the Bin.</strong>
          Bring {{ choosing.parents.length > 1 ? 'them' : 'it' }} back too, so "{{ pageTitle(choosing.page) }}" returns to
          where it was, or put "{{ pageTitle(choosing.page) }}" at the top level of the workspace?
        </p>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="choosing = null">Cancel</button>
          <button class="ghost-btn ghost-btn-background" type="button" @click="restoreFromBin(choosing.page, 'topLevel')">
            Restore to the top level
          </button>
          <button class="ghost-btn ghost-btn-background" type="button" @click="restoreFromBin(choosing.page, 'withParents')">
            Restore with {{ parentLabel }}
          </button>
        </div>
      </div>
      <p v-if="notice" class="muted bin-notice" role="status">{{ notice }}</p>
      <div class="delete-tree" v-if="workspace.binPages.length">
        <ul class="delete-tree-children">
          <li v-for="page in workspace.binPages" :key="page.id">
            <div class="delete-tree-node">
              <span class="delete-tree-title">{{ page.title || 'Untitled page' }}</span>
              <button class="ghost-btn ghost-btn-background" type="button" @click="restoreFromBin(page)">Restore</button>
            </div>
          </li>
        </ul>
      </div>
      <div v-else class="muted">Nothing in the bin.</div>
      <div class="modal-actions">
        <button class="ghost-btn" type="button" @click="emit('close')">Close</button>
        <button class="ghost-btn ghost-btn-background" type="button" @click="destroyBin" :disabled="!workspace.binPages.length">Delete all</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bin-choice,
.bin-notice {
  max-width: 34rem;
}
.bin-choice {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 8px 0 12px;
}
.bin-choice p {
  margin: 0 0 8px;
}
.bin-notice {
  margin: 0 0 8px;
}
</style>
