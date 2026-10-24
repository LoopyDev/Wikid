<template>
  <div class="print-page">
    <div v-if="error" class="print-error">Failed to load page: {{ error }}</div>
    <template v-else-if="page">
      <div class="print-title-row">
        <span v-if="page.icon" class="print-icon" aria-hidden="true">{{ page.icon }}</span>
        <h1 class="print-title">{{ page.title }}</h1>
      </div>
      <TiptapEditor
        :doc="doc"
        :readonly="true"
        :request-delete-confirmation="noOp"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';
import TiptapEditor from './components/TiptapEditor.vue';
import { api } from './api/client';
import { normalizeEditorDoc, fallbackDoc } from './utils/editorDoc';

const params = Object.fromEntries(new URLSearchParams(window.location.search));

// Apply theme before first render so CSS variables are correct from the start
const isDark = params.theme === 'dark';
document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
// In light mode, --content-bg is #f7f7f8 (app grey). Override to white for print.
if (!isDark) {
  document.documentElement.style.setProperty('--content-bg', '#ffffff');
}

const page = ref(null);
const doc = ref(fallbackDoc);
const error = ref('');

const noOp = () => Promise.resolve(false);

const segments = window.location.pathname.split('/');
const pageId = segments[segments.indexOf('print') + 1] ?? '';

onMounted(async () => {
  if (!pageId) {
    error.value = 'No page ID in URL';
    return;
  }
  try {
    const res = await api.getPage(pageId, {
      userId: params.userId,
      userName: params.userName,
    });
    page.value = res;
    doc.value = normalizeEditorDoc(res.content);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 500));
  } catch (err) {
    error.value = err?.message ?? String(err);
  } finally {
    window.__PRINT_READY__ = true;
  }
});
</script>
