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
// Changed in the editor since it was opened or last saved (the editor reports each change, with the
// diagram as it is then): closing asks first
const unsaved = ref(false);
const currentXml = ref('');
// Changes the editor has reported, and how many there had been at the last save: the editor is
// told it's saved only if none came between the save and its picture
let changesReported = 0;
let changesAtSave = -1;
const askingToSave = ref(false);

const openEditor = () => {
  if (!isEditable.value) return;
  pendingClose.value = false;
  askingToSave.value = false;
  unsaved.value = false;
  currentXml.value = '';
  changesReported = 0;
  changesAtSave = -1;
  isOpen.value = true;
};

const closeEditor = () => {
  isOpen.value = false;
  pendingClose.value = false;
  askingToSave.value = false;
};

// The ✕, a click outside, or Escape while the page has the keyboard (in the editor, Escape is the
// editor's). Its own Exit asks for itself (diagrams.net warns of changes it counts as unsaved, and
// it's told only of a save with nothing changed since): with changes not saved, "Save?" first
const requestClose = () => {
  if (unsaved.value) askingToSave.value = true;
  else closeEditor();
};
const saveAndClose = () => {
  askingToSave.value = false;
  saveXml(currentXml.value);
  pendingClose.value = true;
  requestExport(currentXml.value);
};
const keepEditing = () => {
  askingToSave.value = false;
};
const saveXml = (newXml) => {
  props.updateAttributes({ xml: newXml });
  unsaved.value = false;
  changesAtSave = changesReported;
};
// Escape asks rather than closes, and goes no further: a page overlay behind would close too, taking
// the diagram and its changes with it. (The prompt's own Escape is its dialog's.)
const onKeydown = (event) => {
  if (!isOpen.value || askingToSave.value || event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  requestClose();
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
    // (autosave: the editor reports each change, so closing knows if there's one not saved; nothing
    // is saved until Save)
    postToFrame({
      action: 'load',
      xml: xml.value || '<mxGraphModel/>',
      autosave: 1,
    });
  } else if (msg.event === 'autosave') {
    if (typeof msg.xml === 'string') {
      currentXml.value = msg.xml;
      unsaved.value = true;
      changesReported += 1;
    }
  } else if (msg.event === 'save') {
    const newXml = msg.xml || '';
    saveXml(newXml);
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
    // Told it's saved (after the picture, which counts as a change for it): else the editor still
    // counts the changes as unsaved, and its Exit warns that they'll be lost. Not if it changed
    // again since the save (those changes aren't saved), nor as it closes
    if (!pendingClose.value && changesReported === changesAtSave) postToFrame({ action: 'status', modified: false });
    if (pendingClose.value) {
      closeEditor();
    }
  } else if (msg.event === 'error' && pendingClose.value) {
    // The picture couldn't be made: the diagram is saved, so it closes (the page shows the last one)
    closeEditor();
  } else if (msg.event === 'exit') {
    // The editor's own Exit: it has asked about changes not saved itself by then
    closeEditor();
  }
};

onMounted(() => {
  window.addEventListener('message', handleMessage);
  // (First, before a page overlay's own Escape)
  window.addEventListener('keydown', onKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
  window.removeEventListener('keydown', onKeydown, true);
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
      <div v-if="isOpen" class="drawio-modal" @click.self="requestClose">
        <div class="drawio-modal__inner">
          <iframe
            ref="iframeRef"
            :src="DRAWIO_URL"
            class="drawio-modal__iframe"
            frameborder="0"
            allowfullscreen
          />
          <button class="drawio-modal__close" type="button" aria-label="Close" @click="requestClose">✕</button>
          <div v-if="askingToSave" v-dialog="keepEditing" class="drawio-save-prompt" role="alertdialog" aria-label="Save changes?" aria-modal="true">
            <p>Save your changes to this diagram?</p>
            <div class="drawio-save-prompt__actions">
              <button class="drawio-save-prompt__save" type="button" @click="saveAndClose">Save</button>
              <button type="button" @click="closeEditor">Don't save</button>
              <button type="button" @click="keepEditing">Keep editing</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </NodeViewWrapper>
</template>
