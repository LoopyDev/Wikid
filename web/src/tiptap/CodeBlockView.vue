<script setup>
import { computed } from 'vue';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/vue-3';

const props = defineProps({
  node: { type: Object, required: true },
  getPos: { type: Function, required: false },
});

const currentLanguage = computed(() => (props.node?.attrs?.language || '').trim());
const codeBlockPos = computed(() => {
  if (typeof props.getPos !== 'function') return -1;
  try {
    return props.getPos();
  } catch {
    return -1;
  }
});
</script>

<template>
  <NodeViewWrapper
    class="tiptap-codeblock"
    :data-language="currentLanguage || undefined"
    :data-pos="codeBlockPos >= 0 ? codeBlockPos : undefined"
  >
    <code
      class="tiptap-codeblock__code hljs"
      :data-language="currentLanguage || undefined"
      :class="{ [`language-${currentLanguage}`]: !!currentLanguage }"
    >
      <NodeViewContent as="code" />
    </code>
  </NodeViewWrapper>
</template>
