<script setup>
import { useWorkspaceStore } from '../stores/workspace';

// The workspace's rubbish bin: restore pages, or delete them all for good.
const emit = defineEmits(['close']);
const workspace = useWorkspaceStore();

const restoreFromBin = async (page) => {
  await workspace.restorePageFromBin(page);
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
