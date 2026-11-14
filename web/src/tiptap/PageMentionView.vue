<script setup>
import { computed } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import PageIcon from '../components/PageIcon.vue';
import { mentionLabel } from './pageMentionLabel';

// A page mention in a line (pageMention.js): the page's icon and title as they are now, which a
// click opens. A page this person can't see (someone else's private page, one in a workspace
// they're not in) shows as a private page; one in the Bin as deleted.
const props = defineProps(nodeViewProps);

const page = computed(() => props.extension.options.resolvePage?.(props.node.attrs.pageId) || null);
const label = computed(() => mentionLabel(page.value));

const open = (event) => {
  if (!page.value || page.value.isDeleted) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.metaKey || event.ctrlKey) {
    window.open(`/doc/${props.node.attrs.pageId}`, '_blank', 'noopener');
    return;
  }
  props.extension.options.openPage?.(props.node.attrs.pageId);
};
</script>

<template>
  <NodeViewWrapper
    as="a"
    :href="page && !page.isDeleted ? `/doc/${node.attrs.pageId}` : undefined"
    data-type="page-mention"
    :data-page-id="node.attrs.pageId"
    :class="['page-mention', { 'page-mention--unavailable': !page || page.isDeleted }]"
    contenteditable="false"
    @click="open"
  ><PageIcon v-if="page && !page.isDeleted" class="page-mention__icon" :icon="page.icon" fallback="📄" aria-hidden="true" /><span class="page-mention__title">{{ label }}</span></NodeViewWrapper>
</template>
