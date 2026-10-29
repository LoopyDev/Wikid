<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api/client';
import { fallbackDoc, normalizeEditorDoc } from '../utils/editorDoc';
import { useWorkspaceStore } from '../stores/workspace';
import { useApiMutation } from '../composables/useApiMutation';
import PageIcon from './PageIcon.vue';
import IconPicker from './IconPicker.vue';
import TiptapEditor from './TiptapEditor.vue';
import PageProperties from './PageProperties.vue';
import { isInIconBrowser } from '../utils/iconSearch';

const props = defineProps({
  pageId: {
    type: String,
    required: true,
  },
  readonly: {
    type: Boolean,
    default: false,
  },
  requestDeleteConfirmation: {
    type: Function,
    required: true,
  },
  requestComplianceSetup: {
    type: Function,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['close', 'openfull']);

const workspace = useWorkspaceStore();
const page = ref(null);
const doc = ref(fallbackDoc);
const titleDraft = ref('');
const titleInputRef = ref(null);
const pendingSave = ref(null);
const pendingTitleSave = ref(null);
const isEditingTitle = ref(false);
const showIconPicker = ref(false);
const iconTriggerRef = ref(null);
const iconMenuRef = ref(null);
const iconYMap = ref(null);
const iconObserver = ref(null);
const iconSyncedHandler = ref(null);
const collabIconSaveTimer = ref(null);
const activeCollabDoc = ref(null);
const activeCollabProvider = ref(null);

const pageEntry = computed(() => workspace.pages.find((item) => item.id === props.pageId) || null);
const displayPage = computed(() => pageEntry.value || page.value);
const overlayWorkspaceId = computed(
  () => pageEntry.value?.workspaceId || page.value?.workspaceId || workspace.activeWorkspaceId || null
);
const collabContext = computed(() => {
  if (!props.pageId || !overlayWorkspaceId.value) return null;
  if (!workspace.collabToken || !workspace.collabUrl) return null;
  if (workspace.collabWorkspaceId && workspace.collabWorkspaceId !== overlayWorkspaceId.value) return null;
  return { docName: `ws:${overlayWorkspaceId.value}:${props.pageId}`, token: workspace.collabToken, url: workspace.collabUrl };
});
const isCollabEnabled = computed(() => !!collabContext.value);

const canEdit = computed(() => !props.readonly && workspace.canEditActiveWorkspace);
const activeUser = computed(() => workspace.activeUser);

const applyOverlayIcon = (value) => {
  const next = typeof value === 'string' ? value.trim() : '';
  const icon = next || null;
  if (pageEntry.value?.id) {
    workspace.updatePageInLists(pageEntry.value.id, (item) => ({ ...item, icon }));
  }
  if (page.value?.id === props.pageId) {
    page.value = { ...page.value, icon };
  }
};

const clearIconSaveTimer = () => {
  if (collabIconSaveTimer.value) {
    clearTimeout(collabIconSaveTimer.value);
    collabIconSaveTimer.value = null;
  }
};

const persistCollabIcon = (rawIcon) => {
  if (!workspace.hasApi || !props.pageId) return;
  if (!canEdit.value) return;
  const user = activeUser.value;
  if (!user) return;
  clearIconSaveTimer();
  const payload = rawIcon || null;
  collabIconSaveTimer.value = setTimeout(async () => {
    collabIconSaveTimer.value = null;
    try {
      await api.updatePageIcon(props.pageId, payload, { userId: user.id, userName: user.name });
    } catch (err) {
      console.warn('Overlay collab icon save failed', err);
    }
  }, 350);
};

const applyIconFromY = () => {
  if (!iconYMap.value) return;
  const next = iconYMap.value.get('icon') || null;
  applyOverlayIcon(next);
};

const handleIconYChange = (event) => {
  applyIconFromY();
  const origin = event?.transaction?.origin ?? event?.state;
  if (origin === 'icon-local') {
    persistCollabIcon(iconYMap.value?.get('icon') || null);
  }
};

const cleanupIconCollab = () => {
  if (iconYMap.value && iconObserver.value) {
    iconYMap.value.unobserve(iconObserver.value);
  }
  if (iconSyncedHandler.value && activeCollabProvider.value?.off) {
    activeCollabProvider.value.off('synced', iconSyncedHandler.value);
  }
  iconYMap.value = null;
  iconObserver.value = null;
  iconSyncedHandler.value = null;
  activeCollabDoc.value = null;
  activeCollabProvider.value = null;
};

const bindIconCollab = (doc, provider) => {
  if (!doc) return;
  iconYMap.value = doc.getMap('meta');
  const observer = (event) => handleIconYChange(event);
  iconYMap.value.observe(observer);
  iconObserver.value = observer;
  const existingIcon = iconYMap.value.get('icon') || null;
  const localIcon = displayPage.value?.icon || null;
  if (!existingIcon && localIcon) {
    iconYMap.value.set('icon', localIcon);
  }
  const syncedHandler = ({ state }) => {
    if (!state || !iconYMap.value) return;
    const hasIcon = !!iconYMap.value.get('icon');
    const local = displayPage.value?.icon || null;
    if (!hasIcon && local) {
      iconYMap.value.set('icon', local);
    }
  };
  if (provider?.on) {
    provider.on('synced', syncedHandler);
    iconSyncedHandler.value = syncedHandler;
  }
  applyIconFromY();
};

const handleCollabReady = (payload) => {
  const nextDoc = payload?.doc || null;
  const nextProvider = payload?.provider || null;
  const docChanged = nextDoc !== activeCollabDoc.value;
  const providerChanged = nextProvider !== activeCollabProvider.value;
  if (!docChanged && !providerChanged) return;
  cleanupIconCollab();
  activeCollabDoc.value = nextDoc;
  activeCollabProvider.value = nextProvider;
  if (nextDoc) {
    bindIconCollab(nextDoc, nextProvider);
  }
};

const closeIconPicker = () => {
  showIconPicker.value = false;
};

const toggleIconPicker = () => {
  if (!canEdit.value) return;
  showIconPicker.value = !showIconPicker.value;
};

const choosePageIcon = (value) => {
  if (!canEdit.value) return;
  const icon = typeof value === 'string' && value.trim() ? value.trim() : null;
  if (iconYMap.value) {
    iconYMap.value.doc?.transact(() => {
      iconYMap.value.set('icon', icon);
    }, 'icon-local');
    applyOverlayIcon(icon);
    persistCollabIcon(icon);
  } else if (pageEntry.value) {
    workspace.setPageIcon(pageEntry.value, icon);
  } else if (workspace.hasApi && activeUser.value) {
    api.updatePageIcon(props.pageId, icon, { userId: activeUser.value.id, userName: activeUser.value.name })
      .then(() => applyOverlayIcon(icon))
      .catch((err) => console.warn('Overlay icon update failed', err));
  } else {
    applyOverlayIcon(icon);
  }
  closeIconPicker();
};

const handleIconClickOutside = (event) => {
  if (!showIconPicker.value) return;
  const target = event?.target;
  const path = event?.composedPath?.() || [];
  const menuHit = iconMenuRef.value && (path.includes(iconMenuRef.value) || iconMenuRef.value.contains(target));
  const triggerHit = iconTriggerRef.value && (path.includes(iconTriggerRef.value) || iconTriggerRef.value.contains(target));
  if (menuHit || triggerHit || isInIconBrowser(target)) return;
  closeIconPicker();
};

const notifyTitleUpdated = (pageId, title) => {
  if (typeof window === 'undefined' || !pageId) return;
  window.dispatchEvent(
    new CustomEvent('wikid:page-title-updated', {
      detail: { pageId, title },
    })
  );
};

const clearTimers = () => {
  if (pendingSave.value) {
    clearTimeout(pendingSave.value);
    pendingSave.value = null;
  }
  if (pendingTitleSave.value) {
    clearTimeout(pendingTitleSave.value);
    pendingTitleSave.value = null;
  }
};

const saveDoc = async (pageId = props.pageId, payload = doc.value) => {
  if (!pageId || !canEdit.value) return;
  if (isCollabEnabled.value) return;
  if (!workspace.hasApi || !activeUser.value) return;
  const started = workspace.beginSaving();
  try {
    await api.updatePageContent(pageId, normalizeEditorDoc(payload), {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    const now = new Date().toISOString();
    workspace.updatePageInLists(pageId, (item) => ({ ...item, updatedAt: now }));
  } catch (err) {
    error.value = err?.message || 'Failed to save page';
  } finally {
    workspace.finishSaving(started);
  }
};

const saveTitle = async (pageId = props.pageId, nextTitle = titleDraft.value) => {
  if (!pageId || !canEdit.value) return;
  if (!workspace.hasApi || !activeUser.value) return;
  const started = workspace.beginSaving();
  try {
    await api.updatePageTitle(pageId, nextTitle || '', {
      userId: activeUser.value.id,
      userName: activeUser.value.name,
    });
    const now = new Date().toISOString();
    workspace.updatePageInLists(pageId, (item) => ({ ...item, title: nextTitle || '', updatedAt: now }));
    if (page.value?.id === pageId) {
      page.value = { ...page.value, title: nextTitle || '' };
    }
  } catch (err) {
    error.value = err?.message || 'Failed to save title';
  } finally {
    workspace.finishSaving(started);
  }
};

const flushPendingSaves = (pageId) => {
  const docSnapshot = doc.value;
  const titleSnapshot = titleDraft.value;
  if (pendingSave.value) {
    clearTimeout(pendingSave.value);
    pendingSave.value = null;
    if (!isCollabEnabled.value) {
      saveDoc(pageId, docSnapshot);
    }
  }
  if (pendingTitleSave.value) {
    clearTimeout(pendingTitleSave.value);
    pendingTitleSave.value = null;
    saveTitle(pageId, titleSnapshot);
  }
};

const scheduleDocSave = () => {
  if (!canEdit.value) return;
  if (isCollabEnabled.value) return;
  if (pendingSave.value) {
    clearTimeout(pendingSave.value);
  }
  pendingSave.value = setTimeout(() => {
    saveDoc();
    pendingSave.value = null;
  }, 500);
};

const scheduleTitleSave = () => {
  if (!canEdit.value) return;
  if (pendingTitleSave.value) {
    clearTimeout(pendingTitleSave.value);
  }
  pendingTitleSave.value = setTimeout(() => {
    saveTitle();
    pendingTitleSave.value = null;
  }, 400);
};

const resizeTitleInput = (el = titleInputRef.value) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

watch(
  () => pageEntry.value?.title,
  (next) => {
    if (typeof next !== 'string') return;
    if (!isEditingTitle.value && next !== titleDraft.value) {
      titleDraft.value = next;
    }
  }
);

const { loading, error, execute: loadPage } = useApiMutation(async () => {
  if (!props.pageId) return;
  if (!workspace.hasApi) {
    error.value = 'API unavailable';
    page.value = null;
    doc.value = fallbackDoc;
    return;
  }
  page.value = null;
  doc.value = fallbackDoc;
  const res = await api.getPage(props.pageId, {
    userId: activeUser.value?.id,
    userName: activeUser.value?.name,
  });
  page.value = res;
  titleDraft.value = res?.title || '';
  doc.value = normalizeEditorDoc(res?.content);
  if (res) {
    workspace.upsertPage(res);
  }
});

watch(
  () => props.pageId,
  (nextId, prevId) => {
    if (prevId && prevId !== nextId) {
      flushPendingSaves(prevId);
    }
    cleanupIconCollab();
    loadPage();
  },
  { immediate: true }
);

watch(
  titleDraft,
  () => {
    nextTick(() => resizeTitleInput());
  },
  { immediate: true }
);

const handleUpdateDoc = (updated) => {
  doc.value = normalizeEditorDoc(updated);
  scheduleDocSave();
};

const handleTitleInput = (event) => {
  if (!canEdit.value) return;
  const target = event?.target;
  const nextTitle = target?.value ?? '';
  resizeTitleInput(target);
  titleDraft.value = nextTitle;
  notifyTitleUpdated(props.pageId, nextTitle);
  scheduleTitleSave();
};

const handleTitleEnter = (event) => {
  event?.preventDefault?.();
};

const closeOverlay = () => emit('close');
const openFullPage = () => emit('openfull', props.pageId);

const handleKeydown = (event) => {
  if (event.key === 'Escape') {
    if (showIconPicker.value) {
      closeIconPicker();
      return;
    }
    closeOverlay();
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  document.addEventListener('mousedown', handleIconClickOutside, true);
});

onBeforeUnmount(() => {
  flushPendingSaves(props.pageId);
  cleanupIconCollab();
  clearIconSaveTimer();
  clearTimers();
  window.removeEventListener('keydown', handleKeydown);
  document.removeEventListener('mousedown', handleIconClickOutside, true);
});
</script>

<template>
  <div class="page-overlay" role="presentation" @mousedown.self="closeOverlay">
    <section class="page-overlay__panel" role="dialog" aria-modal="true" @mousedown.stop>
      <header class="page-overlay__header">
        <div class="page-overlay__title">
          <div class="page-icon-wrap">
            <button
              ref="iconTriggerRef"
              class="page-overlay__icon-button"
              type="button"
              :disabled="!canEdit"
              aria-label="Change icon"
              @click="toggleIconPicker"
            >
              <PageIcon class="page-overlay__icon" :icon="displayPage?.icon" fallback="DOC" aria-hidden="true" />
            </button>
            <div
              v-if="showIconPicker"
              ref="iconMenuRef"
              class="emoji-menu page-overlay__icon-menu"
              @click.stop
            >
              <IconPicker
                :icon="displayPage?.icon || ''"
                :open="showIconPicker"
                :show-header="false"
                @select="choosePageIcon"
              />
            </div>
          </div>
          <textarea
            ref="titleInputRef"
            class="page-overlay__title-input"
            rows="1"
            :value="titleDraft"
            :readonly="!canEdit"
            placeholder="Untitled page"
            @input="handleTitleInput"
            @keydown.enter.prevent="handleTitleEnter"
            @focus="isEditingTitle = true"
            @blur="isEditingTitle = false"
          ></textarea>
        </div>
        <div class="page-overlay__actions">
          <button class="ghost-btn ghost-btn-background" type="button" @click="openFullPage">Open full page</button>
          <button class="ghost-btn" type="button" @click="closeOverlay">Close</button>
        </div>
      </header>
      <div v-if="error" class="alert page-overlay__alert">{{ error }}</div>
      <div v-else-if="loading" class="muted page-overlay__status">Loading page...</div>
      <div v-else class="page-overlay__body">
        <div class="page-overlay__properties"><PageProperties v-if="pageId" :page-id="pageId" :readonly="!canEdit" /></div>
        <div class="page-overlay__divider" aria-hidden="true"></div>
        <TiptapEditor
          :key="`${pageId || 'no-page'}-${collabContext?.docName || 'local'}-${collabContext?.token ? 'token' : 'no-token'}`"
          :doc="doc"
          :page-id="pageId"
          :collab="collabContext"
          :readonly="!canEdit"
          :request-delete-confirmation="requestDeleteConfirmation"
          :request-compliance-setup="requestComplianceSetup"
          @update:doc="handleUpdateDoc"
          @collabready="handleCollabReady"
        />
      </div>
    </section>
  </div>
</template>
