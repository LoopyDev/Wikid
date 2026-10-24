<script setup>
import { NodeViewWrapper } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  editor: { type: Object, required: true },
  node: { type: Object, required: true },
  updateAttributes: { type: Function, required: true },
  selected: { type: Boolean, default: false },
});

const DRAWIO_ORIGIN = 'https://embed.diagrams.net';
const DRAWIO_URL = `${DRAWIO_ORIGIN}/?embed=1&spin=1&modified=unsavedChanges&proto=json&dark=1`;

const isEditable = computed(() => props.editor?.isEditable ?? true);
const xml = computed(() => props.node?.attrs?.xml || '');
const svg = computed(() => props.node?.attrs?.svg || '');

const isOpen = ref(false);
const iframeRef = ref(null);
// Track whether we're waiting for an export after a save
const pendingClose = ref(false);

const openEditor = () => {
  if (!isEditable.value) return;
  pendingClose.value = false;
  isOpen.value = true;
};

const closeEditor = () => {
  isOpen.value = false;
  pendingClose.value = false;
};

const postToFrame = (msg) => {
  iframeRef.value?.contentWindow?.postMessage(JSON.stringify(msg), DRAWIO_ORIGIN);
};

const requestExport = (xmlToExport) => {
  postToFrame({ action: 'export', format: 'xmlsvg', xml: xmlToExport, spin: 'Saving…' });
};

const handleMessage = (event) => {
  // Accept messages even when pendingClose — we still need the export response
  if (!isOpen.value && !pendingClose.value) return;
  // Only the editor frame itself; a substring check would also accept e.g. diagrams.net.example.com
  if (event.origin !== DRAWIO_ORIGIN || event.source !== iframeRef.value?.contentWindow) return;

  let msg;
  try {
    msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch {
    return;
  }

  if (msg.event === 'init') {
    postToFrame({
      action: 'load',
      xml: xml.value || '<mxGraphModel/>',
      autosave: 0,
    });
  } else if (msg.event === 'save') {
    const newXml = msg.xml || '';
    props.updateAttributes({ xml: newXml });
    if (msg.exit) {
      // User clicked Save & Close — wait for export before closing
      pendingClose.value = true;
      requestExport(newXml);
    } else {
      // User clicked Save (without close) — update preview but stay open
      requestExport(newXml);
    }
  } else if (msg.event === 'export') {
    // msg.data is a data URL: data:image/svg+xml;base64,...
    if (msg.data) {
      props.updateAttributes({ svg: msg.data });
    }
    if (pendingClose.value) {
      closeEditor();
    }
  } else if (msg.event === 'exit') {
    // User closed without saving (or after export already handled)
    closeEditor();
  }
};

onMounted(() => {
  window.addEventListener('message', handleMessage);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
});
</script>

<template>
  <NodeViewWrapper class="drawio-node" :class="{ 'drawio-node--selected': selected }" data-type="drawio">
    <div class="drawio-preview" @click="openEditor">
      <img v-if="svg" :src="svg" class="drawio-preview__img" alt="Diagram" />
      <div v-else class="drawio-preview__empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M17.5 17.5m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0" />
          <line x1="10" y1="6.5" x2="14" y2="6.5" />
          <line x1="6.5" y1="10" x2="6.5" y2="14" />
          <line x1="10" y1="17.5" x2="15" y2="17.5" />
        </svg>
        <span>{{ isEditable ? 'Click to create diagram' : 'Empty diagram' }}</span>
      </div>
      <button v-if="isEditable && svg" class="drawio-preview__edit-btn" type="button" @click.stop="openEditor">
        Edit diagram
      </button>
    </div>

    <Teleport to="body">
      <div v-if="isOpen" class="drawio-modal" @click.self="closeEditor">
        <div class="drawio-modal__inner">
          <iframe
            ref="iframeRef"
            :src="DRAWIO_URL"
            class="drawio-modal__iframe"
            frameborder="0"
            allowfullscreen
          />
          <button class="drawio-modal__close" type="button" aria-label="Close" @click="closeEditor">✕</button>
        </div>
      </div>
    </Teleport>
  </NodeViewWrapper>
</template>
