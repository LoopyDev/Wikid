<script setup>
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';
import { computed, ref } from 'vue';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  getPos: { type: Function, required: true },
  extension: { type: Object, required: true },
});

const canUpload = computed(() => props.editor?.isEditable && typeof props.extension.storage.upload === 'function');
const empty = computed(() => !props.node.textContent);
const uploading = ref(false);
// Its picture already on its way (pasted from Word): it takes this box's place once it's uploaded
const comingAlready = computed(() => !!props.node.attrs.id && props.extension.storage.pending?.has(props.node.attrs.id));

const pickFile = () =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] || null);
    input.click();
  });

// The image goes in just before the box, which then goes: only once it's in, so a failed upload
// leaves the box (and what it asks for) where it was
const upload = async () => {
  if (!canUpload.value || uploading.value || comingAlready.value) return;
  const file = await pickFile();
  if (!file) return;
  uploading.value = true;
  try {
    const inserted = await props.extension.storage.upload([file], props.getPos());
    const pos = props.getPos();
    if (inserted && typeof pos === 'number' && !props.editor.isDestroyed) {
      props.editor.chain().deleteRange({ from: pos, to: pos + props.node.nodeSize }).run();
    }
  } finally {
    uploading.value = false;
  }
};
</script>

<template>
  <NodeViewWrapper class="image-placeholder" :class="{ 'image-placeholder--empty': empty }">
    <i class="bi bi-image image-placeholder__icon" contenteditable="false" aria-hidden="true"></i>
    <NodeViewContent as="p" class="image-placeholder__text" />
    <button
      v-if="canUpload"
      class="ghost-btn image-placeholder__upload"
      type="button"
      contenteditable="false"
      :disabled="uploading || comingAlready"
      @click="upload"
    >
      {{ uploading || comingAlready ? 'Uploading…' : 'Upload' }}
    </button>
  </NodeViewWrapper>
</template>
