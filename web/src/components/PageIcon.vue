<script setup>
import { computed, useAttrs } from 'vue';
import { resolveIcon } from '../utils/icons';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  icon: {
    type: String,
    default: '',
  },
  fallback: {
    type: String,
    default: '📄',
  },
});

const attrs = useAttrs();
const resolved = computed(() => resolveIcon(props.icon, props.fallback));
const iconStyle = computed(() => {
  if (resolved.value.type !== 'svg' || !resolved.value.color) return null;
  return { color: resolved.value.color };
});
const rootAttrs = computed(() => {
  const { class: className, style, ...rest } = attrs;
  let mergedStyle = style;
  if (iconStyle.value) {
    if (Array.isArray(style)) {
      mergedStyle = [...style, iconStyle.value];
    } else if (style && typeof style === 'object') {
      mergedStyle = { ...style, ...iconStyle.value };
    } else if (typeof style === 'string') {
      mergedStyle = `${style}; color: ${iconStyle.value.color};`;
    } else {
      mergedStyle = iconStyle.value;
    }
  }
  return {
    ...rest,
    class: ['icon-display', resolved.value.type === 'svg' ? 'icon-display--svg' : null, className],
    style: mergedStyle,
  };
});
</script>

<template>
  <span v-if="resolved.type === 'svg'" v-bind="rootAttrs" v-html="resolved.svg"></span>
  <span v-else v-bind="rootAttrs">{{ resolved.text }}</span>
</template>
