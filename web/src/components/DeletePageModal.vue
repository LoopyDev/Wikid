<script setup>
import DeleteTreeBranch from './DeleteTreeBranch';

// Confirms deleting a page, listing the sub-pages that go to the Bin with it.
defineProps({
  page: { type: Object, default: null },
  // { title, children: [{ id, title, children }] }
  subtree: { type: Object, default: null },
});
const emit = defineEmits(['cancel', 'confirm']);
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('cancel')">
    <div class="modal-card delete-modal-card">
      <h3>Delete page</h3>
      <p class="muted">
        You are about to delete "{{ page?.title || 'Untitled page' }}" and its sub-pages.
      </p>
      <div class="delete-tree" v-if="subtree">
        <div class="delete-tree-node">
          <span class="delete-tree-title">{{ subtree.title || 'Untitled page' }}</span>
        </div>
        <ul class="delete-tree-children" v-if="subtree.children?.length">
          <li v-for="child in subtree.children" :key="child.id">
            <span class="delete-tree-title">{{ child.title || 'Untitled page' }}</span>
            <delete-tree-branch v-if="child.children?.length" :nodes="child.children" />
          </li>
        </ul>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" type="button" @click="emit('cancel')">Cancel</button>
        <button class="ghost-btn ghost-btn-background" type="button" @click="emit('confirm')">Delete</button>
      </div>
    </div>
  </div>
</template>
