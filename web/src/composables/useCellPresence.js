import { computed, ref } from 'vue';
import { colorFromId } from '../utils/presenceColor';
import { getFontForElement } from '../utils/database/columnLayout';
import { readSelectionOffset } from '../utils/database/cellInput';

// Who is editing which cell: shares this person's focused cell, caret and typing state over the
// database's live-editing connection, and shows everyone else's (with a caret drawn in the cell).
export function useCellPresence({ emit, activeUser, collabProvider, isCollabEnabled, tableWrapRef, flushPendingEnsureRowPages, scheduleSortRefresh }) {
  const localPresenceId = computed(() => activeUser.value?.id || null);
  const presenceUser = computed(() => ({
    id: activeUser.value?.id || 'guest',
    name: activeUser.value?.name || 'Guest',
    color: colorFromId(activeUser.value?.id || 'guest'),
  }));
  const collabCellPresence = ref([]);
  const collabAwarenessSource = ref(null);
  const collabAwarenessHandler = ref(null);
  let localTypingTimer = null;
  let lastLocalCursor = null;
  const cellInputRefs = new Map();
  let caretMeasureCanvas = null;
  const updateAwarenessUser = () => {
    const awareness = collabProvider.value?.awareness;
    if (!awareness) return;
    awareness.setLocalStateField('user', presenceUser.value);
  };
  const setLocalCellCursor = (rowId, fieldId, mode = 'focus', offset = null, value = null, caretLeft = null) => {
    const awareness = collabProvider.value?.awareness;
    if (!awareness) return;
    if (!rowId || !fieldId) {
      lastLocalCursor = null;
      awareness.setLocalStateField('dbCursor', null);
      return;
    }
    lastLocalCursor = {
      rowId,
      fieldId,
      offset: Number.isFinite(offset) ? offset : null,
      value: typeof value === 'string' ? value : null,
      caretLeft: Number.isFinite(caretLeft) ? caretLeft : null,
    };
    awareness.setLocalStateField('dbCursor', {
      rowId,
      fieldId,
      mode,
      offset: Number.isFinite(offset) ? offset : null,
      value: typeof value === 'string' ? value : null,
      caretLeft: Number.isFinite(caretLeft) ? caretLeft : null,
      ts: Date.now(),
    });
  };
  const clearLocalCellCursor = () => {
    if (localTypingTimer) {
      clearTimeout(localTypingTimer);
      localTypingTimer = null;
    }
    setLocalCellCursor(null, null);
  };
  const caretLeftFromTarget = (target) => {
    if (typeof window === 'undefined' || !target) return null;
    const offset = readSelectionOffset(target);
    if (!Number.isFinite(offset)) return null;
    const value = String(target.value ?? '');
    const head = value.slice(0, Math.max(0, offset));
    const font = getFontForElement(target);
    const width = measureTextWidth(head, font);
    const style = window.getComputedStyle(target);
    const paddingLeft = parseFloat(style.paddingLeft || '0') || 0;
    const borderLeft = parseFloat(style.borderLeftWidth || '0') || 0;
    const scrollLeft = target.scrollLeft || 0;
    const raw = width + paddingLeft + borderLeft + 4 - scrollLeft;
    const max = Math.max(6, target.clientWidth - 6);
    return Math.min(Math.max(raw, 6), max);
  };
  const markCellFocus = (rowId, fieldId, target) => {
    if (!isCollabEnabled.value) return;
    if (localTypingTimer) {
      clearTimeout(localTypingTimer);
      localTypingTimer = null;
    }
    setLocalCellCursor(
      rowId,
      fieldId,
      'focus',
      readSelectionOffset(target),
      target?.value ?? null,
      caretLeftFromTarget(target)
    );
  };
  const markCellTyping = (rowId, fieldId, target) => {
    if (!isCollabEnabled.value) return;
    setLocalCellCursor(
      rowId,
      fieldId,
      'typing',
      readSelectionOffset(target),
      target?.value ?? null,
      caretLeftFromTarget(target)
    );
    if (localTypingTimer) {
      clearTimeout(localTypingTimer);
    }
    localTypingTimer = setTimeout(() => {
      localTypingTimer = null;
      const cursor = lastLocalCursor;
      if (cursor && cursor.rowId === rowId && cursor.fieldId === fieldId) {
        setLocalCellCursor(
          cursor.rowId,
          cursor.fieldId,
          'focus',
          cursor.offset,
          cursor.value,
          cursor.caretLeft
        );
      } else {
        setLocalCellCursor(rowId, fieldId, 'focus');
      }
    }, 1200);
  };
  const markCellBlur = () => {
    if (!isCollabEnabled.value) return;
    clearLocalCellCursor();
  };
  const onTableFocusOut = () => {
    // When focus leaves the table entirely, run any deferred sort refresh
    // and flush pending ensureRowPage calls.
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || !tableWrapRef.value?.contains(active)) {
        flushPendingEnsureRowPages();
        scheduleSortRefresh();
      }
    });
  };
  const handleCaretNavigate = (rowId, fieldId, event) => {
    const key = event?.key;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (key && !keys.includes(key)) return;
    markCellFocus(rowId, fieldId, event?.target);
  };
  const handleCaretMouse = (rowId, fieldId, event) => {
    markCellFocus(rowId, fieldId, event?.target);
  };
  const updateCellPresence = () => {
    const awareness = collabProvider.value?.awareness;
    if (!awareness) {
      collabCellPresence.value = [];
      emit('collabpresence', []);
      return;
    }
    const states = Array.from(awareness.getStates().values());
    const topbarEntries = [];
    const cellEntries = [];
    const seen = new Set();
    states.forEach((state) => {
      const user = state?.user;
      if (!user) return;
      const id = user.id || user.name || 'guest';
      if (!seen.has(id)) {
        const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : 'Guest';
        const color = typeof user.color === 'string' && user.color ? user.color : '#3b82f6';
        const letter = name.charAt(0).toUpperCase();
        topbarEntries.push({ id, name, color, letter });
        seen.add(id);
      }
      const cursor = state?.dbCursor;
      if (!cursor?.rowId || !cursor?.fieldId) return;
      if (localPresenceId.value && id === localPresenceId.value) return;
      const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : 'Guest';
      const color = typeof user.color === 'string' && user.color ? user.color : '#3b82f6';
      cellEntries.push({
        id,
        name,
        color,
        rowId: String(cursor.rowId),
        fieldId: String(cursor.fieldId),
        mode: cursor.mode === 'typing' ? 'typing' : 'focus',
        offset: Number.isFinite(cursor.offset) ? cursor.offset : null,
        value: typeof cursor.value === 'string' ? cursor.value : null,
        caretLeft: Number.isFinite(cursor.caretLeft) ? cursor.caretLeft : null,
        ts: typeof cursor.ts === 'number' ? cursor.ts : 0,
      });
    });
    collabCellPresence.value = cellEntries;
    emit('collabpresence', topbarEntries);
  };
  const attachAwarenessListener = () => {
    const awareness = collabProvider.value?.awareness || null;
    if (collabAwarenessSource.value && collabAwarenessHandler.value) {
      collabAwarenessSource.value.off('update', collabAwarenessHandler.value);
    }
    collabAwarenessHandler.value = null;
    collabAwarenessSource.value = awareness;
    if (awareness) {
      const handler = () => updateCellPresence();
      awareness.on('update', handler);
      collabAwarenessHandler.value = handler;
      updateCellPresence();
    } else {
      collabCellPresence.value = [];
      emit('collabpresence', []);
    }
  };
  const setCellInputRef = (rowId, fieldId) => (el) => {
    const key = `${rowId}:${fieldId}`;
    if (!el) {
      cellInputRefs.delete(key);
      return;
    }
    cellInputRefs.set(key, el);
  };
  const getMeasureContext = () => {
    if (typeof document === 'undefined') return null;
    if (!caretMeasureCanvas) {
      caretMeasureCanvas = document.createElement('canvas');
    }
    return caretMeasureCanvas.getContext('2d');
  };
  const measureTextWidth = (text, font) => {
    const ctx = getMeasureContext();
    if (!ctx || !font) return 0;
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const caretLeftForCell = (rowId, fieldId, offset, textValue) => {
    if (typeof window === 'undefined') return 6;
    if (!Number.isFinite(offset)) return 6;
    const el = cellInputRefs.get(`${rowId}:${fieldId}`);
    if (!el) return 6;
    const value = typeof textValue === 'string' ? textValue : String(textValue ?? '');
    const head = value.slice(0, Math.max(0, offset));
    const font = getFontForElement(el);
    const width = measureTextWidth(head, font);
    const style = window.getComputedStyle(el);
    const paddingLeft = parseFloat(style.paddingLeft || '0') || 0;
    const borderLeft = parseFloat(style.borderLeftWidth || '0') || 0;
    const scrollLeft = el.scrollLeft || 0;
    const raw = width + paddingLeft + borderLeft + 4 - scrollLeft;
    const max = Math.max(6, el.clientWidth - 6);
    return Math.min(Math.max(raw, 6), max);
  };
  const cellPresenceMap = computed(() => {
    const map = new Map();
    collabCellPresence.value.forEach((entry) => {
      const key = `${entry.rowId}:${entry.fieldId}`;
      const list = map.get(key) || [];
      list.push(entry);
      map.set(key, list);
    });
    return map;
  });
  const getCellPresence = (rowId, fieldId) =>
    cellPresenceMap.value.get(`${rowId}:${fieldId}`) || [];

  return { attachAwarenessListener, caretLeftForCell, clearLocalCellCursor, getCellPresence, handleCaretMouse, handleCaretNavigate, markCellBlur, markCellFocus, markCellTyping, onTableFocusOut, presenceUser, setCellInputRef, updateAwarenessUser };
}
