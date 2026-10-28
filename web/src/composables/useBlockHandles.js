import { onBeforeUnmount } from 'vue';
import { getColumnOnlyBlock } from '../tiptap/blockPayloads';

// Where the drag handle sits: finds the block (or list) under the pointer and moves the block
// handle or the list handle next to it.
export function useBlockHandles({ handleState, handleVisible, handleLocked, handlePos, wrapperRef, listHandleState, listHandlePos, listHandleTriggerHover, listHandleSelfHover, LIST_HANDLE_OFFSET, LIST_HANDLE_WIDTH, LIST_HANDLE_HOVER_PADDING, handleDragHandleChange, getEditor }) {
  let listHandleHoverTimer = null;
  const setHandleLocked = (locked) => {
    handleLocked.value = !!locked;
    if (!getEditor()) return;
    const { state, view } = getEditor();
    const tr = state.tr.setMeta('lockDragHandle', locked);
    view.dispatch(tr);
  };

  const LIST_CONTAINER_TYPES = new Set(['bulletList', 'orderedList']);
  const LIST_ITEM_TYPE = 'listItem';

  const clearListHandle = () => {
    listHandleState.value = { node: null, pos: -1, element: null };
    listHandlePos.value = { top: 0, left: 0, height: 0 };
    listHandleTriggerHover.value = false;
    listHandleSelfHover.value = false;
    if (listHandleHoverTimer) {
      clearTimeout(listHandleHoverTimer);
      listHandleHoverTimer = null;
    }
  };

  const setListHandleTriggerHover = (next) => {
    if (listHandleHoverTimer) {
      clearTimeout(listHandleHoverTimer);
      listHandleHoverTimer = null;
    }
    if (next) {
      listHandleTriggerHover.value = true;
      return;
    }
    listHandleHoverTimer = setTimeout(() => {
      listHandleTriggerHover.value = false;
      listHandleHoverTimer = null;
    }, 120);
  };

  const setListHandleSelfHover = (next) => {
    listHandleSelfHover.value = !!next;
  };

  const resolveListItemFromPos = (pos) => {
    if (!getEditor()?.state || !getEditor()?.view) return null;
    if (!Number.isFinite(pos)) return null;
    const { state, view } = getEditor();
    const $pos = state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      if (node?.type?.name === LIST_ITEM_TYPE) {
        const itemPos = $pos.before(depth);
        const element = view.nodeDOM(itemPos);
        if (element instanceof HTMLElement) {
          return { element, node, pos: itemPos };
        }
        return null;
      }
    }
    return null;
  };

  const resolveListContainerFromPos = (pos) => {
    if (!getEditor()?.state || !getEditor()?.view) return null;
    if (!Number.isFinite(pos)) return null;
    const { state, view } = getEditor();
    const $pos = state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      if (LIST_CONTAINER_TYPES.has(node?.type?.name)) {
        const listPos = $pos.before(depth);
        const element = view.nodeDOM(listPos);
        if (element instanceof HTMLElement) {
          return { element, node, pos: listPos };
        }
        return null;
      }
    }
    return null;
  };

  const resolveListItemFromTarget = (target, clientY) => {
    if (!getEditor()?.view) return null;
    const listEl = target?.closest?.('ul, ol');
    if (!(listEl instanceof HTMLElement)) return null;
    const items = Array.from(listEl.querySelectorAll('li')).filter((item) => item instanceof HTMLElement);
    if (!items.length) return null;
    const y = typeof clientY === 'number' ? clientY : null;
    const getDepth = (item) => {
      let depth = 0;
      let node = item.parentElement;
      while (node && node !== listEl) {
        if (node.tagName === 'UL' || node.tagName === 'OL') {
          depth += 1;
        }
        node = node.parentElement;
      }
      return depth;
    };
    const candidates = items
      .map((item) => {
        const rect = item.getBoundingClientRect?.();
        if (!rect) return null;
        return { item, rect, depth: getDepth(item) };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
        if (a.depth !== b.depth) return b.depth - a.depth;
        return a.rect.height - b.rect.height;
      });
    if (!candidates.length) return null;
    let chosen = null;
    if (y != null) {
      const inside = candidates.filter((entry) => y >= entry.rect.top && y <= entry.rect.bottom);
      if (inside.length) {
        inside.sort((a, b) => {
          if (a.depth !== b.depth) return b.depth - a.depth;
          return a.rect.height - b.rect.height;
        });
        chosen = inside[0];
      } else {
        const nextIndex = candidates.findIndex((entry) => y < entry.rect.top);
        if (nextIndex === -1) {
          chosen = candidates[candidates.length - 1];
        } else if (nextIndex === 0) {
          chosen = candidates[0];
        } else {
          chosen = candidates[nextIndex - 1];
        }
      }
    }
    if (!chosen) {
      const fallback = target?.closest?.('li');
      if (fallback instanceof HTMLElement) {
        chosen = candidates.find((entry) => entry.item === fallback) || candidates[0];
      } else {
        chosen = candidates[0];
      }
    }
    if (!chosen?.item) return null;
    let pos = null;
    try {
      pos = getEditor().view.posAtDOM(chosen.item, 0);
    } catch {
      pos = null;
    }
    if (!Number.isFinite(pos)) return null;
    return resolveListItemFromPos(pos);
  };

  const resolveOutermostListContainerFromPos = (pos) => {
    if (!getEditor()?.state || !getEditor()?.view) return null;
    if (!Number.isFinite(pos)) return null;
    const { state, view } = getEditor();
    const $pos = state.doc.resolve(pos);
    let target = null;
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      if (!LIST_CONTAINER_TYPES.has(node?.type?.name)) continue;
      const listPos = $pos.before(depth);
      const element = view.nodeDOM(listPos);
      if (element instanceof HTMLElement) {
        target = { element, node, pos: listPos };
      }
    }
    return target;
  };

  const updateListHandleFromHit = (hit, wrapperRect) => {
    if (!hit?.node || hit.node.type?.name !== LIST_ITEM_TYPE) {
      clearListHandle();
      return;
    }
    const listHit = resolveListContainerFromPos(hit.pos);
    if (!listHit?.element) {
      clearListHandle();
      return;
    }
    const rect = listHit.element.getBoundingClientRect?.();
    if (!rect) {
      clearListHandle();
      return;
    }
    const topOffset = wrapperRect ? rect.top - wrapperRect.top : rect.top;
    const baseLeft = Number.isFinite(handlePos.value.left)
      ? handlePos.value.left
      : wrapperRect
        ? rect.left - wrapperRect.left
        : rect.left;
    listHandleState.value = listHit;
    listHandlePos.value = {
      top: topOffset + rect.height / 2,
      left: baseLeft - LIST_HANDLE_OFFSET,
      height: rect.height,
    };
  };

  const isListHandleHoverGutter = (event, wrapperRect) => {
    const { height, top } = listHandlePos.value;
    const handleLeft = handlePos.value.left;
    if (!Number.isFinite(handleLeft) || !Number.isFinite(height) || height <= 0) return false;
    if (typeof event?.clientX !== 'number' || typeof event?.clientY !== 'number') return false;
    const localX = wrapperRect ? event.clientX - wrapperRect.left : event.clientX;
    const localY = wrapperRect ? event.clientY - wrapperRect.top : event.clientY;
    const topEdge = top - height / 2;
    const bottomEdge = top + height / 2;
    if (localY < topEdge || localY > bottomEdge) return false;
    const zoneLeft = handleLeft - (LIST_HANDLE_OFFSET + LIST_HANDLE_WIDTH + LIST_HANDLE_HOVER_PADDING);
    const zoneRight = handleLeft;
    return localX >= zoneLeft && localX <= zoneRight;
  };

  const resolveListHandleTarget = () => {
    const listHandle = listHandleState.value;
    if (listHandle?.pos != null && listHandle.pos >= 0) {
      if (LIST_CONTAINER_TYPES.has(listHandle.node?.type?.name)) {
        return listHandle;
      }
      const fromListPos = resolveListContainerFromPos(listHandle.pos);
      if (fromListPos) return fromListPos;
    }
    const handlePos = handleState.value?.pos;
    if (handleState.value?.node?.type?.name === LIST_ITEM_TYPE && typeof handlePos === 'number' && handlePos >= 0) {
      return resolveListContainerFromPos(handlePos);
    }
    return null;
  };

  const applyListHandleSelection = () => {
    const listTarget = resolveListHandleTarget();
    if (!listTarget?.node || listTarget.pos == null || listTarget.pos < 0) return false;
    handleDragHandleChange({ node: listTarget.node, pos: listTarget.pos });
    return true;
  };

  // Anything inside a table belongs to the table: its handle moves the whole table, not one
  // cell's text (which left the table behind with that cell emptied)
  const tableAround = (pos) => {
    const { view, state } = getEditor();
    if (!Number.isFinite(pos) || pos < 0 || pos > state.doc.content.size) return null;
    const $pos = state.doc.resolve(pos);
    for (let depth = 1; depth <= $pos.depth; depth += 1) {
      if ($pos.node(depth)?.type?.name !== 'table') continue;
      const tablePos = $pos.before(depth);
      const element = view.nodeDOM(tablePos);
      return element instanceof HTMLElement ? { element, node: $pos.node(depth), pos: tablePos } : null;
    }
    return null;
  };

  const resolveHandleCandidate = (event) => {
    if (!getEditor()?.view || !event) return null;
    if (typeof event.clientX !== 'number' || typeof event.clientY !== 'number') return null;
    const { view, state } = getEditor();
    const tableEl = event.target?.closest?.('table');
    if (tableEl && view.dom.contains(tableEl)) {
      const hit = tableAround(view.posAtDOM(tableEl, 0));
      if (hit) return hit;
    }
    const listItemTarget = resolveListItemFromTarget(event.target, event.clientY);
    if (listItemTarget) {
      return listItemTarget;
    }
    const closestBlock = event.target?.closest?.('[data-block-pos],[data-pos]');
    const blockPosAttr = closestBlock?.getAttribute?.('data-block-pos') || closestBlock?.getAttribute?.('data-pos');
    const attrPos = blockPosAttr ? parseInt(blockPosAttr, 10) : NaN;
    if (Number.isFinite(attrPos)) {
      const nodeAt = state.doc.nodeAt(attrPos);
      if (nodeAt?.isBlock) {
        const typeName = nodeAt.type?.name;
        if (typeName === 'heading') {
          const $pos = state.doc.resolve(attrPos);
          for (let depth = $pos.depth; depth > 0; depth -= 1) {
            const parent = $pos.node(depth);
            if (parent?.type?.name === 'toggleHeading') {
              const togglePos = $pos.before(depth);
              const element = view.nodeDOM(togglePos);
              if (element instanceof HTMLElement) {
                return { element, node: parent, pos: togglePos };
              }
              break;
            }
          }
        }
        if (LIST_CONTAINER_TYPES.has(typeName)) {
          const listEl = view.nodeDOM(attrPos);
          const listItemFromContainer = resolveListItemFromTarget(listEl, event.clientY);
          if (listItemFromContainer) {
            return listItemFromContainer;
          }
        }
        const listItemHit = resolveListItemFromPos(attrPos);
        if (listItemHit) {
          const listItemFromContainer = resolveListItemFromTarget(listItemHit.element, event.clientY);
          if (listItemFromContainer) {
            return listItemFromContainer;
          }
          return listItemHit;
        }
        if (typeName === 'column') {
          const only = getColumnOnlyBlock(nodeAt, attrPos);
          if (only) {
            const element = view.nodeDOM(only.pos);
            if (element instanceof HTMLElement) {
              return { element, node: only.node, pos: only.pos };
            }
          }
        } else if (typeName !== 'columns' && !LIST_CONTAINER_TYPES.has(typeName)) {
          const element = closestBlock instanceof HTMLElement ? closestBlock : view.nodeDOM(attrPos);
          if (element instanceof HTMLElement) {
            return { element, node: nodeAt, pos: attrPos };
          }
        }
      }
    }
    let resolvedPos = null;
    if (resolvedPos == null) {
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (!coords?.pos && coords?.pos !== 0) return null;
      resolvedPos = coords.pos;
    }
    const tableHit = tableAround(resolvedPos);
    if (tableHit) return tableHit;
    const listItemHit = resolveListItemFromPos(resolvedPos);
    if (listItemHit) {
      const listItemFromContainer = resolveListItemFromTarget(listItemHit.element, event.clientY);
      if (listItemFromContainer) {
        return listItemFromContainer;
      }
      return listItemHit;
    }
    const $pos = state.doc.resolve(resolvedPos);
    let inColumn = false;
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth)?.type?.name === 'column') {
        inColumn = true;
        break;
      }
    }
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      const node = $pos.node(depth);
      if (!node?.isBlock) continue;
      const pos = $pos.before(depth);
      const typeName = node.type?.name;
      if (LIST_CONTAINER_TYPES.has(typeName)) {
        const listEl = view.nodeDOM(pos);
        const listItemFromContainer = resolveListItemFromTarget(listEl, event.clientY);
        if (listItemFromContainer) {
          return listItemFromContainer;
        }
        continue;
      }
      if (typeName === 'column') {
        const only = getColumnOnlyBlock(node, pos);
        if (only) {
          const element = view.nodeDOM(only.pos);
          if (element instanceof HTMLElement) {
            return { element, node: only.node, pos: only.pos };
          }
        }
        continue;
      }
      if (typeName === 'columns') continue;
      const isTopLevel = depth === 1;
      if (!isTopLevel && !inColumn) continue;
      let element = view.nodeDOM(pos);
      if (!(element instanceof HTMLElement)) {
        if (closestBlock instanceof HTMLElement) {
          element = closestBlock;
        } else {
          continue;
        }
      }
      return { element, node, pos };
    }
    return null;
  };

  const hideBlockHandle = () => {
    if (handleLocked.value) return;
    handleVisible.value = false;
    handleDragHandleChange({ node: null, pos: -1 });
    clearListHandle();
  };

  const updateBlockHandleFromEvent = (event) => {
    if (!getEditor() || getEditor().isDestroyed || !getEditor().isEditable) {
      hideBlockHandle();
      return;
    }
    if (handleLocked.value) return;
    const target = event?.target;
    const isFormControl =
      target?.closest?.('.form-page')
      && !!target?.closest?.('input, select, textarea, button, .form-input, .form-submit-btn, .form-checkbox');
    if (isFormControl) {
      hideBlockHandle();
      return;
    }
    const isHandle = target?.closest?.('.drag-handle');
    const isMenu = target?.closest?.('.block-menu') || target?.closest?.('.bubble-menu') || target?.closest?.('.emoji-menu');
    if (isHandle || isMenu) return;
    const hit = resolveHandleCandidate(event);
    if (!hit?.element) {
      hideBlockHandle();
      return;
    }
    const rect = hit.element.getBoundingClientRect();
    if (!rect) {
      hideBlockHandle();
      return;
    }
    const wrapperEl = wrapperRef.value;
    const wrapperRect = wrapperEl?.getBoundingClientRect?.();
    const topOffset = wrapperRect ? rect.top - wrapperRect.top : rect.top;
    const listContainer = hit.node?.type?.name === LIST_ITEM_TYPE ? resolveOutermostListContainerFromPos(hit.pos) : null;
    const leftRect = listContainer?.element?.getBoundingClientRect?.() || rect;
    const leftOffset = wrapperRect ? leftRect.left - wrapperRect.left : leftRect.left;
    const styles = getComputedStyle(hit.element);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const fontSize = Number.parseFloat(styles.fontSize);
    const effectiveLineHeight = Number.isFinite(lineHeight)
      ? lineHeight
      : Number.isFinite(fontSize)
        ? fontSize * 1.4
        : rect.height;
    const topAligned = rect.height > effectiveLineHeight * 1.4;
    handleVisible.value = true;
    handlePos.value = {
      top: topOffset + (topAligned ? effectiveLineHeight / 2 : rect.height / 2),
      left: leftOffset,
    };
    updateListHandleFromHit(hit, wrapperRect);
    if (hit.node?.type?.name === LIST_ITEM_TYPE) {
      setListHandleTriggerHover(isListHandleHoverGutter(event, wrapperRect));
    } else {
      setListHandleTriggerHover(false);
    }
    if (handleState.value?.pos !== hit.pos || handleState.value?.node !== hit.node) {
      handleDragHandleChange({ node: hit.node, pos: hit.pos });
    }
  };

  onBeforeUnmount(() => clearTimeout(listHandleHoverTimer));

  return { setHandleLocked, LIST_CONTAINER_TYPES, LIST_ITEM_TYPE, setListHandleTriggerHover, setListHandleSelfHover, resolveListItemFromPos, resolveListItemFromTarget, resolveListHandleTarget, applyListHandleSelection, updateBlockHandleFromEvent };
}
