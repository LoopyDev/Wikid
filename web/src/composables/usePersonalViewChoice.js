import { computed, ref, watch } from 'vue';

// What one person has chosen to see in a database view block: its saved view and hidden columns.
// Kept in their browser only, so it changes nothing for anyone else; the block's own choice, saved
// in the page, is what everyone sees until they choose otherwise (and can be replaced with theirs).

const STORAGE_PREFIX = 'wikid:db-view-choice:';

const sameList = (a = [], b = []) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * `storageKey`: a ref naming the block (null when it can't be told apart, then nothing is kept).
 * `saved`: a ref of the block's own { viewId, hiddenFields }.
 */
export function usePersonalViewChoice({ storageKey, saved }) {
  const read = () => {
    if (!storageKey.value) return {};
    try {
      const raw = JSON.parse(window.localStorage.getItem(STORAGE_PREFIX + storageKey.value) || '{}');
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  };
  const choice = ref(read());
  watch(storageKey, () => {
    choice.value = read();
  });

  const write = (next) => {
    // Only what differs from the block's own choice is kept
    const kept = {};
    if ('viewId' in next && (next.viewId || null) !== (saved.value.viewId || null)) kept.viewId = next.viewId || null;
    if (Array.isArray(next.hiddenFields) && !sameList(next.hiddenFields, saved.value.hiddenFields)) kept.hiddenFields = next.hiddenFields;
    choice.value = kept;
    if (!storageKey.value) return;
    try {
      if (Object.keys(kept).length) window.localStorage.setItem(STORAGE_PREFIX + storageKey.value, JSON.stringify(kept));
      else window.localStorage.removeItem(STORAGE_PREFIX + storageKey.value);
    } catch {
      // Not kept (private window, storage off): it still applies until the page is left
    }
  };

  const viewId = computed(() => ('viewId' in choice.value ? choice.value.viewId : saved.value.viewId) || null);
  const hiddenFields = computed(() => (Array.isArray(choice.value.hiddenFields) ? choice.value.hiddenFields : saved.value.hiddenFields || []));
  const differs = computed(() => viewId.value !== (saved.value.viewId || null) || !sameList(hiddenFields.value, saved.value.hiddenFields));

  // Someone saved this person's choice for everyone (or the same one): nothing left to keep
  watch(saved, () => write({ ...choice.value }), { deep: true });

  return {
    viewId,
    hiddenFields,
    differs,
    setViewId: (next) => write({ ...choice.value, viewId: next || null }),
    setHiddenFields: (next) => write({ ...choice.value, hiddenFields: Array.isArray(next) ? next : [] }),
    reset: () => write({}),
  };
}
