<script setup>
import { computed, onMounted, ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

// Saves a page (with its subpages) as a template: the workspace's or the person's own. Then says
// what was changed to make it fit one (images to image placeholders, workspace-only blocks left out).
const props = defineProps({
  pageId: { type: String, required: true },
  pageTitle: { type: String, default: '' },
});
const emit = defineEmits(['close']);
const workspace = useWorkspaceStore();

const inPersonalWorkspace = computed(() => workspace.templates?.personalWorkspaceId === workspace.activeWorkspaceId);
const canSaveToWorkspace = computed(() => workspace.canEditActiveWorkspace && !inPersonalWorkspace.value);
const scope = ref('personal');
const saving = ref(false);
const error = ref('');
const saved = ref(null); // { id, workspaceId, notes }

onMounted(async () => {
  await workspace.loadTemplates();
  if (canSaveToWorkspace.value) scope.value = 'workspace';
});

const save = async () => {
  saving.value = true;
  error.value = '';
  const created = await workspace.createTemplate({ scope: scope.value, fromPageId: props.pageId });
  saving.value = false;
  if (created) saved.value = created;
  else error.value = workspace.error || "Couldn't save the template.";
};

const openTemplate = async () => {
  const { id, workspaceId } = saved.value;
  emit('close');
  await workspace.openPageById(id, workspaceId);
};
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div v-dialog="() => emit('close')" class="modal-card save-template-modal" role="dialog" aria-labelledby="save-template-title">
      <h3 id="save-template-title">Save as template</h3>
      <template v-if="!saved">
        <p class="muted">
          A copy of "{{ pageTitle || 'Untitled page' }}" and its subpages, to start new pages from. Images become
          image placeholders, and database views, forms, page links and Gaussian splats are left out, since they
          belong to this workspace.
        </p>
        <fieldset class="save-template-scope" aria-label="Whose template">
          <label v-if="canSaveToWorkspace">
            <input v-model="scope" type="radio" value="workspace" />
            <span><strong>This workspace's</strong> <span class="muted">— shared with everyone in it</span></span>
          </label>
          <label>
            <input v-model="scope" type="radio" value="personal" />
            <span><strong>Mine</strong> <span class="muted">— only for me, in every workspace</span></span>
          </label>
        </fieldset>
        <span v-if="error" class="alert">{{ error }}</span>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="emit('close')">Cancel</button>
          <button class="ghost-btn ghost-btn-background" type="button" :disabled="saving" @click="save">
            {{ saving ? 'Saving…' : 'Save as template' }}
          </button>
        </div>
      </template>
      <template v-else>
        <p>Saved to {{ saved.scope === 'personal' ? 'your templates' : "this workspace's templates" }}.</p>
        <ul v-if="saved.notes.length" class="save-template-notes">
          <li v-for="note in saved.notes" :key="note">{{ note }}</li>
        </ul>
        <div class="modal-actions">
          <button class="ghost-btn" type="button" @click="emit('close')">Done</button>
          <button class="ghost-btn ghost-btn-background" type="button" @click="openTemplate">Open template</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.save-template-modal {
  width: min(480px, calc(100vw - 32px));
}
.save-template-scope {
  border: 0;
  margin: 12px 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.save-template-scope label {
  display: flex;
  gap: 8px;
  align-items: baseline;
  cursor: pointer;
}
.save-template-notes {
  margin: 0 0 8px;
  padding-left: 1.2rem;
}
</style>
