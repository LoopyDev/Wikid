<script setup>
import { computed, onMounted, ref } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';

// Shown on a template's page (or one of its subpages): whose template it is, and making a page
// from it. Changes here change the template, not pages already made from it.
const props = defineProps({
  page: { type: Object, required: true },
});
const emit = defineEmits(['browse', 'delete']);
const workspace = useWorkspaceStore();
const busy = ref(false);

// The template this page is (or is part of)
const root = computed(() => {
  let page = props.page;
  const seen = new Set();
  while (page?.parentId && !seen.has(page.id)) {
    seen.add(page.id);
    const parent = workspace.pages.find((p) => p.id === page.parentId);
    if (!parent?.isTemplate) break;
    page = parent;
  }
  return page;
});
const isRoot = computed(() => root.value.id === props.page.id);
const personal = computed(() => workspace.templates?.personalWorkspaceId === props.page.workspaceId);
const subpages = computed(() =>
  workspace.pages.filter((p) => p.parentId === props.page.id && p.isTemplate && !p.isDeleted)
);
const canEdit = computed(() => workspace.canEditActiveWorkspace);

const useIt = async () => {
  busy.value = true;
  await workspace.useTemplate(root.value.id, { visibility: 'PRIVATE' });
  busy.value = false;
};
const addSubpage = () => workspace.addChildPage(props.page);
const open = (page) => workspace.selectPage(page);

onMounted(() => {
  if (!workspace.templates) workspace.loadTemplates();
});
</script>

<template>
  <div class="template-banner" role="note">
    <div class="template-banner__text">
      <strong>{{ personal ? 'Your template' : "This workspace's template" }}</strong>
      <span v-if="!isRoot">
        · part of
        <button class="template-banner__link" type="button" @click="open(root)">{{ root.title || 'Untitled template' }}</button>
      </span>
      <span class="muted">
        Pages made from it start as a copy of it{{ isRoot ? ' and its subpages' : '' }}. Changes here don't change them.
      </span>
      <span v-if="subpages.length" class="template-banner__subpages">
        Subpages:
        <template v-for="(sub, index) in subpages" :key="sub.id">
          <button class="template-banner__link" type="button" @click="open(sub)">{{ sub.title || 'Untitled page' }}</button
          ><span v-if="index < subpages.length - 1">, </span>
        </template>
      </span>
    </div>
    <div class="template-banner__actions">
      <button class="ghost-btn" type="button" @click="emit('browse')">All templates</button>
      <button v-if="canEdit" class="ghost-btn" type="button" @click="addSubpage">Add a subpage</button>
      <button v-if="canEdit" class="ghost-btn" type="button" @click="emit('delete', page.id)">Delete</button>
      <button v-if="canEdit" class="ghost-btn ghost-btn-background" type="button" :disabled="busy" @click="useIt">
        Use this template
      </button>
    </div>
  </div>
</template>

<style scoped>
.template-banner {
  grid-column: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  background: var(--highlight-color-blue);
  border: 1px solid var(--text-color-blue);
  color: var(--text-primary);
  padding: 10px 14px;
  border-radius: 10px;
}
.template-banner__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.template-banner__subpages {
  font-size: 0.9rem;
}
.template-banner__link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.template-banner__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
