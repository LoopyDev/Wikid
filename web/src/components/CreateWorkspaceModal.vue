<script setup>
import { ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

// Asks for a name and creates a workspace (the store then opens it).
const emit = defineEmits(['close']);
const workspace = useWorkspaceStore();

const newWorkspaceName = ref('');
const createWsError = ref('');
const createWsLoading = ref(false);
const submitCreateWorkspace = async () => {
  const name = newWorkspaceName.value.trim();
  if (!name) return;
  createWsLoading.value = true;
  createWsError.value = '';
  try {
    await workspace.createWorkspace(name);
    emit('close');
  } catch (err) {
    createWsError.value = err?.message || 'Failed to create workspace';
  } finally {
    createWsLoading.value = false;
  }
};
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card">
      <h3>New workspace</h3>
      <form @submit.prevent="submitCreateWorkspace">
        <input
          v-model="newWorkspaceName"
          class="modal-text-input"
          type="text"
          placeholder="Workspace name"
          maxlength="80"
          autofocus
        />
        <p v-if="createWsError" class="modal-error">{{ createWsError }}</p>
        <div class="modal-actions">
          <button class="ghost-btn ghost-btn-background" type="submit" :disabled="!newWorkspaceName.trim() || createWsLoading">
            {{ createWsLoading ? 'Creating…' : 'Create' }}
          </button>
          <button class="ghost-btn" type="button" @click="emit('close')">Cancel</button>
        </div>
      </form>
    </div>
  </div>
</template>
