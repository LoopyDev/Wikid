import { ref } from 'vue';

// Moving a database's columns: by dragging a header, or "Move left/right" in its menu. With live
// editing the new order goes in the document's field order (saved from there); otherwise each
// moved column's position is saved through the API.
export function useColumnReorder({ fields, isHidden = () => false, isReadonly, isCollabEnabled, whenCollabSynced, ensureCollabDoc, collabFieldOrder, readCollabOrder, saveFieldPosition }) {
  // The column being dragged, and where it would land: { fieldId, side: 'before' | 'after' }
  const draggingFieldId = ref(null);
  const dropTarget = ref(null);

  /** Moves a column so it sits at `toIndex` among the columns. */
  const moveField = async (fieldId, toIndex) => {
    if (isReadonly.value) return;
    const order = fields.value.map((field) => field.id);
    const from = order.indexOf(fieldId);
    const to = Math.max(0, Math.min(order.length - 1, toIndex));
    if (from < 0 || from === to) return;
    order.splice(from, 1);
    order.splice(to, 0, fieldId);

    if (isCollabEnabled.value) {
      whenCollabSynced(() => {
        const doc = ensureCollabDoc();
        const fieldOrder = collabFieldOrder.value || doc.getArray('fieldOrder');
        const current = readCollabOrder(fieldOrder);
        const index = current.indexOf(fieldId);
        if (index < 0) return;
        // Where it goes among the document's order: before the column that will follow it
        const next = order[to + 1];
        doc.transact(() => {
          fieldOrder.delete(index, 1);
          const after = readCollabOrder(fieldOrder);
          const at = next ? after.indexOf(next) : after.length;
          fieldOrder.insert(at < 0 ? after.length : at, [fieldId]);
        }, 'db-field-move');
      });
      return;
    }
    const byId = new Map(fields.value.map((field) => [field.id, field]));
    fields.value = order.map((id, index) => ({ ...byId.get(id), position: index + 1 }));
    await Promise.all(order.map((id, index) => (byId.get(id)?.position === index + 1 ? null : saveFieldPosition(id, index + 1))));
  };

  /** Moves a column past its neighbour on screen (-1 left, 1 right), skipping hidden columns. */
  const moveFieldBy = (fieldId, step) => {
    const shown = fields.value.filter((field) => field.id === fieldId || !isHidden(field.id)).map((field) => field.id);
    const neighbour = shown[shown.indexOf(fieldId) + step];
    if (!neighbour) return;
    const others = fields.value.map((field) => field.id).filter((id) => id !== fieldId);
    const at = others.indexOf(neighbour);
    return moveField(fieldId, step > 0 ? at + 1 : at);
  };
  const canMoveBy = (fieldId, step) => {
    const shown = fields.value.filter((field) => field.id === fieldId || !isHidden(field.id)).map((field) => field.id);
    return !!shown[shown.indexOf(fieldId) + step];
  };

  const handleHeaderDragStart = (fieldId, event) => {
    if (isReadonly.value || !event?.dataTransfer) return;
    draggingFieldId.value = fieldId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-wikid-column', fieldId);
  };

  const handleHeaderDragOver = (fieldId, event) => {
    if (!draggingFieldId.value || !fieldId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget?.getBoundingClientRect?.();
    const side = rect && event.clientX > rect.left + rect.width / 2 ? 'after' : 'before';
    dropTarget.value = fieldId === draggingFieldId.value ? null : { fieldId, side };
  };

  const handleHeaderDrop = (event) => {
    event.preventDefault();
    const fieldId = draggingFieldId.value;
    const target = dropTarget.value;
    handleHeaderDragEnd();
    if (!fieldId || !target) return;
    const order = fields.value.map((field) => field.id).filter((id) => id !== fieldId);
    const targetIndex = order.indexOf(target.fieldId);
    if (targetIndex < 0) return;
    void moveField(fieldId, target.side === 'after' ? targetIndex + 1 : targetIndex);
  };

  const handleHeaderDragEnd = () => {
    draggingFieldId.value = null;
    dropTarget.value = null;
  };

  const dropSideFor = (fieldId) => (dropTarget.value?.fieldId === fieldId ? dropTarget.value.side : null);

  return { draggingFieldId, moveField, moveFieldBy, canMoveBy, dropSideFor, handleHeaderDragStart, handleHeaderDragOver, handleHeaderDrop, handleHeaderDragEnd };
}
