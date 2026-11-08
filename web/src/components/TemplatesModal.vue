<script setup>
import { computed, onMounted, ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import PageIcon from './PageIcon.vue';

// The templates offered in the workspace: its own (shared with its members), the person's own (in
// every workspace) and the built-in ones. Make a page from one, open one to change it, copy one to
// your own, or start a new one.
const emit = defineEmits(['close']);
const workspace = useWorkspaceStore();

const busy = ref(false);
const notice = ref('');
const templates = computed(() => workspace.templates);
const inPersonalWorkspace = computed(() => !!templates.value && templates.value.personalWorkspaceId === workspace.activeWorkspaceId);
const canEdit = computed(() => workspace.canEditActiveWorkspace);

const sections = computed(() => {
  const t = templates.value;
  if (!t) return [];
  return [
    !inPersonalWorkspace.value && {
      key: 'workspace',
      title: 'This workspace',
      hint: "Shared with everyone in this workspace.",
      items: t.workspace,
      canAdd: canEdit.value,
    },
    { key: 'personal', title: 'Yours', hint: 'Only you see these, in every workspace.', items: t.personal, canAdd: true },
    { key: 'builtIn', title: 'Built-in', hint: '', items: t.builtIn, canAdd: false },
  ].filter(Boolean);
});

const describe = (template) => {
  if (template.description) return template.description;
  if (template.subpageCount) return `With ${template.subpageCount} subpage${template.subpageCount === 1 ? '' : 's'}`;
  return '';
};

const run = async (task) => {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    await task();
  } finally {
    busy.value = false;
  }
};

const useTemplate = (template) =>
  run(async () => {
    if (await workspace.useTemplate(template.id, { visibility: 'PRIVATE' })) emit('close');
    else notice.value = workspace.error || "Couldn't make the page.";
  });

const openTemplate = (template) =>
  run(async () => {
    const workspaceId = template.scope === 'personal' ? templates.value.personalWorkspaceId : workspace.activeWorkspaceId;
    emit('close');
    await workspace.openPageById(template.id, workspaceId);
  });

const copyToMine = (template) =>
  run(async () => {
    const created = await workspace.createTemplate({ scope: 'personal', fromTemplateId: template.id });
    notice.value = created ? `Copied "${template.title}" to your templates.` : workspace.error || "Couldn't copy it.";
  });

const newTemplate = (scope) =>
  run(async () => {
    const created = await workspace.createTemplate({ scope, title: 'Untitled template' });
    if (!created) {
      notice.value = workspace.error || "Couldn't make the template.";
      return;
    }
    emit('close');
    await workspace.openPageById(created.id, created.workspaceId);
  });

onMounted(() => workspace.loadTemplates());
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal-card templates-modal" role="dialog" aria-labelledby="templates-modal-title">
      <h3 id="templates-modal-title">Templates</h3>
      <p class="muted">
        Start a page from a template, or open one to change it. To make one from a page you've written, use
        <strong>Save as template…</strong> in that page's menu.
      </p>
      <p v-if="notice" class="muted templates-notice" role="status">{{ notice }}</p>
      <div v-if="!templates" class="muted">Loading…</div>
      <section v-for="section in sections" :key="section.key" class="templates-section">
        <div class="templates-section__head">
          <h4>{{ section.title }}</h4>
          <span v-if="section.hint" class="muted">{{ section.hint }}</span>
          <button
            v-if="section.canAdd"
            class="ghost-btn templates-section__add"
            type="button"
            :disabled="busy"
            @click="newTemplate(section.key)"
          >
            + New template
          </button>
        </div>
        <p v-if="!section.items.length" class="muted templates-empty">None yet.</p>
        <ul v-else class="templates-list">
          <li v-for="template in section.items" :key="template.id" class="templates-item">
            <PageIcon class="templates-item__icon" :icon="template.icon" fallback="📄" aria-hidden="true" />
            <div class="templates-item__text">
              <span class="templates-item__title">{{ template.title }}</span>
              <span v-if="describe(template)" class="muted templates-item__desc">{{ describe(template) }}</span>
            </div>
            <div class="templates-item__actions">
              <button
                v-if="section.key !== 'builtIn' && (section.key === 'personal' || canEdit)"
                class="ghost-btn"
                type="button"
                :disabled="busy"
                @click="openTemplate(template)"
              >
                Edit
              </button>
              <button v-if="section.key !== 'personal'" class="ghost-btn" type="button" :disabled="busy" @click="copyToMine(template)">
                Copy to mine
              </button>
              <button v-if="canEdit" class="ghost-btn ghost-btn-background" type="button" :disabled="busy" @click="useTemplate(template)">
                Use
              </button>
            </div>
          </li>
        </ul>
      </section>
      <div class="modal-actions">
        <button class="ghost-btn" type="button" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.templates-modal {
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  overflow-y: auto;
}
.templates-notice {
  margin: 0 0 8px;
}
.templates-section {
  margin-top: 16px;
}
.templates-section__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.templates-section__head h4 {
  margin: 0;
}
.templates-section__head .muted {
  font-size: 0.85rem;
}
.templates-section__add {
  margin-left: auto;
}
.templates-empty {
  margin: 0;
  font-size: 0.9rem;
}
.templates-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
}
.templates-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}
.templates-item + .templates-item {
  border-top: 1px solid var(--surface-border);
}
.templates-item__icon {
  font-size: 1.2rem;
  flex: none;
}
.templates-item__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.templates-item__title {
  font-weight: 600;
}
.templates-item__desc {
  font-size: 0.85rem;
}
.templates-item__actions {
  display: flex;
  gap: 6px;
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}
@media (max-width: 560px) {
  .templates-item {
    flex-wrap: wrap;
  }
  .templates-item__actions {
    width: 100%;
  }
}
</style>
