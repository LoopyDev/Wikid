<script setup>
import { computed, ref, toRef, watch } from 'vue';
import { Selection } from '@tiptap/pm/state';
import { useWorkspaceStore } from '../stores/workspace';
import { SYNCED_FROM_ATTR } from '../tiptap/editorShared';
import { codeBlockLanguages, dividerAlignOptions, dividerSizeOptions, highlightOptions, textColorOptions } from '../tiptap/editorMenuOptions';
import { getPageLinkFieldSource, pageLinkBuiltinAttributes, parsePageLinkAttribute } from '../utils/pageLinkAttributes';

// The menu behind a block's drag handle: turn the block into another type, colour, code and
// divider options, page-link style and attributes, copy a link to it, or delete it.
// It opens on the main panel each time; the editor positions it and closes it.
const props = defineProps({
  editor: { type: Object, default: null },
  // The block the handle is on: { node, pos }.
  handleState: { type: Object, required: true },
  pageId: { type: String, default: null },
  getResolvedPage: { type: Function, required: true },
  // From usePageLinkAttributes: getPageLinkAttributeData, loadPageLinkAttributes,
  // pageLinkDatabaseLoading, pageLinkDatabaseErrors.
  pageLinkAttributes: { type: Object, required: true },
});
const emit = defineEmits(['close']);

const workspace = useWorkspaceStore();
const editor = computed(() => props.editor);
const handleState = toRef(props, 'handleState');
const getResolvedPage = (id) => props.getResolvedPage(id);
const { getPageLinkAttributeData, loadPageLinkAttributes, pageLinkDatabaseLoading, pageLinkDatabaseErrors } = props.pageLinkAttributes;
const closeTuneMenu = () => emit('close');
const currentColor = computed(() => editor.value?.getAttributes('textStyle')?.color || '');
const currentHighlightColor = computed(() => editor.value?.getAttributes('highlight')?.color || '');

const panelState = ref('root'); // root | turnInto | colour | highlight | divider | dividerAlign | code | pageLinkStyle | pageLinkAttributes

const tuneMenuDir = ref('forward'); // forward | backward

const getHandleNode = () => {
  const doc = editor.value?.state?.doc;
  const pos = handleState.value?.pos;
  if (!doc || pos == null || pos < 0) return null;
  try {
    return doc.nodeAt(pos);
  } catch {
    return null;
  }
};

const currentHorizontalRuleColor = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'horizontalRule') return '';
  return typeof node.attrs?.color === 'string' ? node.attrs.color : '';
});

const currentHorizontalRuleSize = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'horizontalRule') return 'medium';
  const size = node.attrs?.size;
  return size === 'small' || size === 'large' ? size : 'medium';
});

const currentHorizontalRuleAlign = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'horizontalRule') return 'middle';
  const align = node.attrs?.align;
  return align === 'top' || align === 'bottom' ? align : 'middle';
});

const currentPageLinkStyle = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'pageLink') return 'card';
  return node.attrs?.style === 'small' ? 'small' : 'card';
});

const currentPageLinkTargetId = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'pageLink') return '';
  return typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : '';
});

const currentPageLinkAttribute = computed(() => {
  const node = getHandleNode();
  if (!node || node.type?.name !== 'pageLink') return '';
  return typeof node.attrs?.attribute === 'string' ? node.attrs.attribute : '';
});

const currentPageLinkAttributeParts = computed(() => parsePageLinkAttribute(currentPageLinkAttribute.value));

const currentPageLinkAttributeData = computed(() => getPageLinkAttributeData(currentPageLinkTargetId.value));

const currentPageLinkDatabasePageId = computed(() => currentPageLinkAttributeData.value?.databasePageId || '');

const currentPageLinkAttributeFields = computed(() => {
  const fields = currentPageLinkAttributeData.value?.database?.fields || [];
  return fields.filter((field) => getPageLinkFieldSource(field) !== 'page');
});

const currentPageLinkAttributeLabel = computed(() => {
  const selection = currentPageLinkAttributeParts.value;
  if (!selection.kind) return 'Page link';
  if (selection.kind === 'builtin') {
    return pageLinkBuiltinAttributes.find((item) => item.id === `builtin:${selection.key}`)?.label || 'Attribute';
  }
  const match = currentPageLinkAttributeFields.value.find((field) => field?.id === selection.key);
  return match?.name || 'Attribute';
});

const currentPageLinkAttributeLoading = computed(() => {
  const databasePageId = currentPageLinkDatabasePageId.value;
  if (!databasePageId) return false;
  return !!pageLinkDatabaseLoading[databasePageId];
});

const currentPageLinkAttributeError = computed(() => {
  const databasePageId = currentPageLinkDatabasePageId.value;
  if (!databasePageId) return '';
  return pageLinkDatabaseErrors[databasePageId] || '';
});

const handleTextColor = computed(() => {
  const node = getHandleNode();
  if (!node) return '';
  let color = '';
  let mixed = false;
  node.descendants((child) => {
    if (mixed) return false;
    if (!child.isText) return;
    const mark = child.marks.find((item) => item.type?.name === 'textStyle' && item.attrs?.color);
    if (!mark?.attrs?.color) return false;
    if (!color) {
      color = mark.attrs.color;
      return false;
    }
    if (color !== mark.attrs.color) {
      mixed = true;
    }
    return false;
  });
  return mixed ? '' : color;
});

const tuneTextColor = computed(() => {
  const node = getHandleNode();
  if (node?.type?.name === 'horizontalRule') {
    return currentHorizontalRuleColor.value || 'var(--surface-border)';
  }
  return handleTextColor.value || currentColor.value || 'var(--context-menu-text)';
});

const handleHighlightColor = computed(() => {
  const node = getHandleNode();
  if (!node) return '';
  let color = '';
  let mixed = false;
  node.descendants((child) => {
    if (mixed) return false;
    if (!child.isText) return;
    const mark = child.marks.find((item) => item.type?.name === 'highlight' && item.attrs?.color);
    if (!mark?.attrs?.color) return false;
    if (!color) {
      color = mark.attrs.color;
      return false;
    }
    if (color !== mark.attrs.color) {
      mixed = true;
    }
    return false;
  });
  return mixed ? '' : color;
});

const tuneHighlightColor = computed(() => handleHighlightColor.value || currentHighlightColor.value || '');

const isImageBlock = computed(() => handleState.value?.node?.type?.name === 'image');

const isCodeBlock = computed(() => handleState.value?.node?.type?.name === 'codeBlock');

const isHorizontalRule = computed(() => handleState.value?.node?.type?.name === 'horizontalRule');

const isPageLinkBlock = computed(() => handleState.value?.node?.type?.name === 'pageLink');
const isDatabaseViewBlock = computed(() => handleState.value?.node?.type?.name === 'databaseView');
const databaseViewShowsTitle = computed(() => getHandleNode()?.attrs?.showTitle !== false);
const databaseViewShowsControls = computed(() => getHandleNode()?.attrs?.showControls !== false);
const databaseViewShowsAddButtons = computed(() => getHandleNode()?.attrs?.showAddButtons !== false);

const currentCodeLanguage = computed(() => {
  const handleLang = handleState.value?.node?.attrs?.language;
  if (typeof handleLang === 'string' && handleLang.trim()) return handleLang.trim();
  const selectionLang = editor.value?.getAttributes('codeBlock')?.language;
  return typeof selectionLang === 'string' ? selectionLang.trim() : '';
});

// The menu acts on the block its handle is on, which needn't be where the text cursor was. So the
// editor takes focus back without scrolling: focus() on its own scrolls to that old cursor first,
// which jumped the page (often to the top) on Delete, Turn into and colours.
const focusInPlace = () => editor.value.chain().focus(undefined, { scrollIntoView: false });

const withHandleSelection = (fn) => {
  if (!editor.value) return false;
  const { pos } = handleState.value;
  if (pos == null || pos < 0) return false;
  const safePos = Math.max(1, Math.min(pos + 1, editor.value.state.doc.content.size - 1));
  return fn(focusInPlace().setTextSelection(safePos));
};

const withHandleRangeTransaction = (fn) => {
  if (!editor.value) return false;
  const { node, pos } = handleState.value;
  if (!node || pos == null || pos < 0) return false;
  const { state, view } = editor.value;
  const start = Math.max(1, pos + 1);
  const end = Math.min(pos + Math.max(1, node.nodeSize - 1), state.doc.content.size);
  const nextTr = fn(state.tr, start, end, state);
  if (!nextTr) return false;
  view.dispatch(nextTr);
  return true;
};

const showBlockCopyBanner = (blockId) => {
  if (typeof window === 'undefined' || !blockId) return;
  const target = document.querySelector(`[data-block-id="${blockId}"]`);
  if (!(target instanceof HTMLElement)) return;
  const rect = target.getBoundingClientRect();
  const banner = document.createElement('div');
  banner.className = 'block-copy-banner';
  banner.textContent = 'Link copied';
  const left = Math.min(rect.right - 6, window.innerWidth - 8);
  const top = Math.min(Math.max(rect.top, 24), window.innerHeight - 8);
  banner.style.left = `${left}px`;
  banner.style.top = `${top}px`;
  document.body.appendChild(banner);
  window.setTimeout(() => {
    banner.remove();
  }, 1400);
};

const copyBlockLink = async () => {
  const pos = handleState.value?.pos;
  if (!editor.value || !props.pageId) return;
  const node = handleState.value?.node;
  let blockId = node?.attrs?.id;
  if (!blockId && typeof pos === 'number' && pos >= 0) {
    blockId = editor.value.state.doc.nodeAt(pos)?.attrs?.id;
  }
  if (!blockId) {
    // fallback to current selection block
    try {
      const $from = editor.value.state.selection.$from;
      const parent = $from?.node($from.depth);
      blockId = parent?.attrs?.id || null;
    } catch {
      blockId = null;
    }
  }
  if (!blockId) {
    window.alert('Could not find a block ID to copy.');
    return;
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const page = getResolvedPage(props.pageId);
  const workspaceId = page?.workspaceId || workspace.activePageWorkspaceId || null;
  if (!workspaceId) {
    window.alert('Current page is missing a workspace. Please reload or re-open the page.');
    return;
  }
  const url = `${origin}/ws/${encodeURIComponent(workspaceId)}/doc/${props.pageId}#${blockId}`;
  try {
    await navigator.clipboard.writeText(url);
    closeTuneMenu();
    showBlockCopyBanner(blockId);
  } catch {
    window.prompt('Copy block link', url);
  }
};

const isSyncedHandle = computed(() => !!handleState.value?.node?.attrs?.[SYNCED_FROM_ATTR]);

// Turn into is for text blocks, and lists and their items. Other blocks (dividers, images, embeds,
// callouts, columns, tables) don't have it: there it changed the block next to them, or nothing.
const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);
const LIST_TYPES = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' };
const LIST_ITEM_TYPES = new Set(['listItem', 'taskItem']);
const handleType = computed(() => handleState.value?.node?.type?.name || '');
const canTurnInto = computed(() => TEXT_BLOCK_TYPES.has(handleType.value) || handleType.value in LIST_TYPES || LIST_ITEM_TYPES.has(handleType.value));
// A whole list only turns into another kind of list: as text, only its first item would change
const turnIntoListsOnly = computed(() => handleType.value in LIST_TYPES);

// What the block is now, ticked in the menu: paragraph, heading1-3, codeBlock, or a list type (for
// an item, its list's)
const currentBlockKind = computed(() => {
  const node = getHandleNode();
  const type = node?.type?.name;
  if (type === 'heading') return `heading${node.attrs?.level}`;
  if (LIST_ITEM_TYPES.has(type)) {
    try {
      return editor.value.state.doc.resolve(handleState.value.pos).parent.type.name;
    } catch {
      return '';
    }
  }
  return type || '';
});

const TURN_INTO_OPTIONS = [
  { kind: 'paragraph', icon: 'Tx', title: 'Paragraph', hint: 'Turn into text' },
  { kind: 'heading1', icon: 'H1', title: 'Heading 1', hint: 'Large heading' },
  { kind: 'heading2', icon: 'H2', title: 'Heading 2', hint: 'Section heading' },
  { kind: 'heading3', icon: 'H3', title: 'Heading 3', hint: 'Sub heading' },
  { kind: 'codeBlock', icon: '</>', title: 'Code block', hint: 'Monospace block' },
  { kind: 'taskList', icon: '[ ]', title: 'To-do', hint: 'Checkbox list' },
  { kind: 'bulletList', icon: '*', title: 'Bulleted list', hint: 'Turn into bullets' },
  { kind: 'orderedList', icon: '1.', title: 'Numbered list', hint: 'Turn into ordered' },
];
const turnIntoOptions = computed(() => (turnIntoListsOnly.value ? TURN_INTO_OPTIONS.filter((option) => option.kind in LIST_TYPES) : TURN_INTO_OPTIONS));

const turnInto = (kind) => {
  const node = getHandleNode();
  const pos = handleState.value?.pos;
  if (!editor.value || !node || pos == null || pos < 0 || kind === currentBlockKind.value) {
    closeTuneMenu();
    return;
  }
  // Into the block's text: its own, or its first item's
  let textPos = node.isTextblock ? pos + 1 : null;
  node.descendants((child, offset) => {
    if (textPos != null) return false;
    if (child.isTextblock) textPos = pos + 1 + offset + 1;
  });
  if (textPos == null) return;
  let chain = focusInPlace().setTextSelection(textPos);
  // A code block: a line of text for each of its lines (they ran into one), all of them turned
  if (node.type.name === 'codeBlock') {
    const { schema } = editor.value.state;
    const lines = node.textContent.split('\n').map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
    const size = lines.reduce((total, line) => total + line.nodeSize, 0);
    chain = focusInPlace()
      .command(({ tr }) => {
        tr.replaceWith(pos, pos + node.nodeSize, lines);
        return true;
      })
      .setTextSelection({ from: pos + 1, to: pos + size - 1 });
  }
  // An item leaves its list first, all the way out of a nested one: as text, or, if it's just a line,
  // as another kind of list of its own (in its list, it turned the whole list, and joined it to the
  // next one; an item holding more, a sub-list say, still turns its whole list)
  const toList = kind in LIST_TYPES;
  if (LIST_ITEM_TYPES.has(node.type.name) && (!toList || node.childCount === 1)) {
    const $text = editor.value.state.doc.resolve(textPos);
    for (let depth = $text.depth; depth > 0; depth -= 1) {
      if ($text.node(depth).type.name === node.type.name) chain = chain.liftListItem(node.type.name);
    }
  }
  if (kind === 'paragraph') chain = chain.setParagraph();
  else if (kind.startsWith('heading')) chain = chain.setHeading({ level: Number(kind.slice(-1)) });
  else if (kind === 'codeBlock') chain = chain.setCodeBlock();
  else if (kind === 'bulletList') chain = chain.toggleBulletList();
  else if (kind === 'orderedList') chain = chain.toggleOrderedList();
  else if (kind === 'taskList') chain = chain.toggleTaskList();
  chain.run();
  closeTuneMenu();
};

const setCodeBlockLanguage = (language) => {
  const next = typeof language === 'string' ? language : '';
  withHandleSelection((chain) => chain.updateAttributes('codeBlock', { language: next || null }).run());
  closeTuneMenu();
};

const updateHorizontalRuleAttrs = (attrs) => {
  if (!editor.value) return false;
  const node = getHandleNode();
  const pos = handleState.value?.pos;
  if (!node || node.type?.name !== 'horizontalRule' || pos == null || pos < 0) return false;
  const { state, view } = editor.value;
  const nextAttrs = { ...node.attrs, ...attrs };
  const tr = state.tr.setNodeMarkup(pos, node.type, nextAttrs);
  view.dispatch(tr);
  return true;
};

const setHorizontalRuleColor = (color) => updateHorizontalRuleAttrs({ color });

const clearHorizontalRuleColor = () => updateHorizontalRuleAttrs({ color: null });

const setHorizontalRuleSize = (size) => updateHorizontalRuleAttrs({ size });

const setHorizontalRuleAlign = (align) => updateHorizontalRuleAttrs({ align });

const updatePageLinkAttrs = (attrs) => {
  if (!editor.value) return false;
  const node = getHandleNode();
  const pos = handleState.value?.pos;
  if (!node || node.type?.name !== 'pageLink' || pos == null || pos < 0) return false;
  const { state, view } = editor.value;
  const nextAttrs = { ...node.attrs, ...attrs };
  const tr = state.tr.setNodeMarkup(pos, node.type, nextAttrs);
  view.dispatch(tr);
  return true;
};

// A database view block's title, its controls (view picker, Columns, search), or its add
// row and column buttons, on or off
const toggleDatabaseViewAttr = (name) => {
  if (!editor.value) return;
  const node = getHandleNode();
  const pos = handleState.value?.pos;
  if (!node || node.type?.name !== 'databaseView' || pos == null || pos < 0) return;
  const { state, view } = editor.value;
  view.dispatch(state.tr.setNodeMarkup(pos, node.type, { ...node.attrs, [name]: node.attrs?.[name] === false }));
  closeTuneMenu();
};

const setPageLinkStyle = (style) => {
  const next = style === 'small' ? 'small' : 'card';
  updatePageLinkAttrs({ style: next });
  closeTuneMenu();
};

const setPageLinkAttribute = (attribute) => {
  const next = typeof attribute === 'string' ? attribute : '';
  updatePageLinkAttrs({ attribute: next });
  closeTuneMenu();
};

const applyTextColorOption = (color) => {
  if (isHorizontalRule.value) {
    setHorizontalRuleColor(color);
    return;
  }
  setTextColor(color);
};

const resetTextColorOption = () => {
  if (isHorizontalRule.value) {
    clearHorizontalRuleColor();
    return;
  }
  clearTextColor();
};

const setTextColor = (color) => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.textStyle;
    if (!markType) return null;
    return tr.addMark(start, end, markType.create({ color }));
  });
};

const clearTextColor = () => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.textStyle;
    if (!markType) return null;
    return tr.removeMark(start, end, markType);
  });
};

const setHighlightColor = (color) => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.highlight;
    if (!markType) return null;
    return tr.addMark(start, end, markType.create({ color }));
  });
};

const clearHighlight = () => {
  withHandleRangeTransaction((tr, start, end, state) => {
    const markType = state.schema.marks.highlight;
    if (!markType) return null;
    return tr.removeMark(start, end, markType);
  });
};

const openPanel = (next) => {
  if (isImageBlock.value && next !== 'root') return;
  if (next === 'turnInto' && !canTurnInto.value) return;
  if (isHorizontalRule.value && next === 'highlight') return;
  if (!isHorizontalRule.value && next === 'divider') return;
  if (!isHorizontalRule.value && next === 'dividerAlign') return;
  panelState.value = next;
  tuneMenuDir.value = next === 'root' ? 'backward' : 'forward';
  if (next === 'pageLinkAttributes') {
    loadPageLinkAttributes(currentPageLinkTargetId.value);
  }
};

const deleteBlock = () => {
  if (!editor.value) return;
  const { node, pos } = handleState.value;
  if (!node || pos == null || pos < 0) return;
  focusInPlace()
    .command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize);
      // The cursor where the block was: the start of the next block, or the end of the one before
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))));
      return true;
    })
    .run();
  closeTuneMenu();
};

// When the handle moves to another kind of block, leave panels that don't apply to it.
watch(
  () => handleState.value?.node,
  (node) => {
    if (!node) return;
    const type = node.type?.name;
    const panel = panelState.value;
    const offPanel =
      (type === 'image' && panel !== 'root') ||
      (panel === 'turnInto' && !canTurnInto.value) ||
      (type === 'horizontalRule' && panel === 'highlight') ||
      (type !== 'horizontalRule' && (panel === 'divider' || panel === 'dividerAlign')) ||
      (type !== 'pageLink' && (panel === 'pageLinkStyle' || panel === 'pageLinkAttributes'));
    if (offPanel) {
      panelState.value = 'root';
      tuneMenuDir.value = 'backward';
    }
  }
);
</script>

<template>
  <div class="block-menu__panel-stack">
    <transition :name="tuneMenuDir === 'backward' ? 'block-menu-slide-back' : 'block-menu-slide'" mode="out-in">
      <div :key="panelState" class="block-menu__panel">
        <template v-if="panelState === 'root'">
          <div class="block-menu__panel-scroll block-menu__panel-scroll--root">
            <button v-if="canTurnInto" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('turnInto')">
              <span class="block-menu__icon"><i class="bi bi-arrow-repeat" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Turn into…</span>
                <span class="block-menu__hint">Change block type</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button v-if="isCodeBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('code')">
              <span class="block-menu__icon"><i class="bi bi-code-square" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Code options</span>
                <span class="block-menu__hint">Set language</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button v-if="isDatabaseViewBlock" class="block-menu__item" type="button" @click="toggleDatabaseViewAttr('showTitle')">
              <span class="block-menu__icon">Ti</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Show title</span>
              </span>
              <span v-if="databaseViewShowsTitle" class="block-menu__chevron">✓</span>
            </button>
            <button v-if="isDatabaseViewBlock" class="block-menu__item" type="button" @click="toggleDatabaseViewAttr('showControls')">
              <span class="block-menu__icon">Ct</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Show controls</span>
              </span>
              <span v-if="databaseViewShowsControls" class="block-menu__chevron">✓</span>
            </button>
            <button v-if="isDatabaseViewBlock" class="block-menu__item" type="button" @click="toggleDatabaseViewAttr('showAddButtons')">
              <span class="block-menu__icon">+</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Show add row and column</span>
              </span>
              <span v-if="databaseViewShowsAddButtons" class="block-menu__chevron">✓</span>
            </button>
            <button v-if="isPageLinkBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('pageLinkStyle')">
              <span class="block-menu__icon">St</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Style</span>
                <span class="block-menu__hint">Card or small</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button v-if="isPageLinkBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('pageLinkAttributes')">
              <span class="block-menu__icon">At</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Attributes</span>
                <span class="block-menu__hint">{{ currentPageLinkAttributeLabel }}</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <div v-if="!isImageBlock" class="block-menu__divider" role="separator" aria-hidden="true"></div>
            <button v-if="!isImageBlock" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('colour')">
              <span class="block-menu__icon block-menu__icon--text" :style="{ color: tuneTextColor }">
                <i class="bi bi-alphabet" aria-hidden="true"></i>
              </span>
              <span class="block-menu__text">
                <span class="block-menu__title">Colour</span>
                <span class="block-menu__hint">Text colour</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button v-if="isHorizontalRule" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('divider')">
              <span class="block-menu__icon"><i class="bi bi-arrows-vertical" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Divider height</span>
                <span class="block-menu__hint">Small, medium, large</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button v-if="isHorizontalRule" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('dividerAlign')">
              <span class="block-menu__icon"><i class="bi bi-align-middle" aria-hidden="true"></i></span>
              <span class="block-menu__text">
                <span class="block-menu__title">Divider alignment</span>
                <span class="block-menu__hint">Top, middle, bottom</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button v-if="!isImageBlock && !isHorizontalRule" class="block-menu__item block-menu__item--submenu" type="button" @click.stop="openPanel('highlight')">
              <span class="block-menu__icon block-menu__icon--highlight" :style="{ color: tuneTextColor }">
                <span class="block-menu__icon-highlight" :style="{ '--block-menu-highlight-color': tuneHighlightColor || 'transparent' }">
                  <i class="bi bi-alphabet" aria-hidden="true"></i>
                </span>
              </span>
              <span class="block-menu__text">
                <span class="block-menu__title">Highlight</span>
                <span class="block-menu__hint">Highlight text</span>
              </span>
              <span class="block-menu__chevron">›</span>
            </button>
            <button class="block-menu__item" type="button" @click="copyBlockLink">
              <span class="block-menu__icon">🔗</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Copy block link</span>
                <span class="block-menu__hint">Link to this block</span>
              </span>
            </button>
            <div v-if="isSyncedHandle" class="block-menu__notice">You are editing the original synced block!</div>
            <button class="block-menu__item" type="button" @click="deleteBlock">
              <span class="block-menu__icon">x</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Delete</span>
                <span class="block-menu__hint">Remove this block</span>
                </span>
              </button>
          </div>
        </template>
        <template v-else-if="panelState === 'turnInto'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Turn into</span>
          </div>
          <div class="block-menu__panel-scroll">
            <button v-for="option in turnIntoOptions" :key="option.kind" class="block-menu__item" type="button" @click="turnInto(option.kind)">
              <span class="block-menu__icon">{{ option.icon }}</span>
              <span class="block-menu__text">
                <span class="block-menu__title">{{ option.title }}</span>
                <span class="block-menu__hint">{{ option.hint }}</span>
              </span>
              <span v-if="option.kind === currentBlockKind" class="block-menu__chevron">✓</span>
            </button>
          </div>
        </template>
        <template v-else-if="panelState === 'colour'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Colour</span>
          </div>
          <div class="block-menu__panel-scroll">
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">{{ isHorizontalRule ? 'Rule colour' : 'Text colour' }}</div>
              <div class="block-menu__color-list">
                <button
                  class="block-menu__color-btn"
                  type="button"
                  :aria-label="isHorizontalRule ? 'Default rule color' : 'Default text color'"
                  @click="resetTextColorOption"
                >
                  <span class="block-menu__color-dot block-menu__color-dot--default"></span>
                  <span class="block-menu__color-label">Default</span>
                </button>
                <button
                  v-for="option in textColorOptions"
                  :key="option.value"
                  class="block-menu__color-btn"
                  type="button"
                  :aria-label="(isHorizontalRule ? 'Rule color ' : 'Text color ') + option.name"
                  @click="applyTextColorOption(option.value)"
                >
                  <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
                  <span class="block-menu__color-label">{{ option.name }}</span>
                </button>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="panelState === 'highlight'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Highlight</span>
          </div>
          <div class="block-menu__panel-scroll">
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Highlight</div>
              <div class="block-menu__color-list">
                <button class="block-menu__color-btn" type="button" aria-label="No highlight" @click="clearHighlight">
                  <span class="block-menu__color-dot block-menu__color-dot--reset"></span>
                  <span class="block-menu__color-label">None</span>
                </button>
                <button
                  v-for="option in highlightOptions"
                  :key="option.value"
                  class="block-menu__color-btn"
                  type="button"
                  :aria-label="'Highlight color ' + option.name"
                  @click="setHighlightColor(option.value)"
                >
                  <span class="block-menu__color-dot" :style="{ backgroundColor: option.value }"></span>
                  <span class="block-menu__color-label">{{ option.name }}</span>
                </button>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="panelState === 'pageLinkStyle'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Page link style</span>
          </div>
          <div class="block-menu__panel-scroll">
            <button class="block-menu__item" type="button" @click="setPageLinkStyle('card')">
              <span class="block-menu__icon">Cd</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Card</span>
                <span class="block-menu__hint">Full card layout</span>
              </span>
              <span v-if="currentPageLinkStyle === 'card'" class="block-menu__chevron">✓</span>
            </button>
            <button class="block-menu__item" type="button" @click="setPageLinkStyle('small')">
              <span class="block-menu__icon">Sm</span>
              <span class="block-menu__text">
                <span class="block-menu__title">Small</span>
                <span class="block-menu__hint">Icon + title only</span>
              </span>
              <span v-if="currentPageLinkStyle === 'small'" class="block-menu__chevron">✓</span>
            </button>
          </div>
        </template>
        <template v-else-if="panelState === 'pageLinkAttributes'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Page link attributes</span>
          </div>
          <div class="block-menu__panel-scroll">
            <div v-if="!currentPageLinkTargetId" class="block-menu__notice">Link a page to show attributes.</div>
            <div v-else-if="currentPageLinkAttributeError" class="block-menu__notice">{{ currentPageLinkAttributeError }}</div>
            <div v-else-if="currentPageLinkAttributeLoading" class="block-menu__notice">Loading attributes...</div>
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Display</div>
              <button class="block-menu__item" type="button" @click="setPageLinkAttribute('')">
                <span class="block-menu__icon">--</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">None</span>
                  <span class="block-menu__hint">Show Page link label</span>
                </span>
                <span v-if="!currentPageLinkAttributeParts.kind" class="block-menu__chevron">✓</span>
              </button>
            </div>
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Page</div>
              <button
                v-for="option in pageLinkBuiltinAttributes"
                :key="option.id"
                class="block-menu__item"
                type="button"
                @click="setPageLinkAttribute(option.id)"
              >
                <span class="block-menu__icon">Pg</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">{{ option.label }}</span>
                </span>
                <span v-if="currentPageLinkAttribute === option.id" class="block-menu__chevron">✓</span>
              </button>
            </div>
            <div v-if="currentPageLinkDatabasePageId" class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Database</div>
              <button
                v-for="field in currentPageLinkAttributeFields"
                :key="field.id"
                class="block-menu__item"
                type="button"
                @click="setPageLinkAttribute(`field:${field.id}`)"
              >
                <span class="block-menu__icon">Db</span>
                <span class="block-menu__text">
                  <span class="block-menu__title">{{ field.name || 'Field' }}</span>
                </span>
                <span v-if="currentPageLinkAttribute === `field:${field.id}`" class="block-menu__chevron">✓</span>
              </button>
              <div v-if="!currentPageLinkAttributeFields.length && !currentPageLinkAttributeLoading" class="block-menu__notice">
                No database attributes.
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="panelState === 'divider'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Divider height</span>
          </div>
          <div class="block-menu__panel-scroll">
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Height</div>
              <div class="block-menu__color-list">
                <button
                  v-for="option in dividerSizeOptions"
                  :key="option.value"
                  class="block-menu__color-btn"
                  type="button"
                  :aria-label="'Divider height ' + option.name"
                  @click="setHorizontalRuleSize(option.value)"
                >
                  <span class="block-menu__color-dot block-menu__color-dot--divider" :data-size="option.value"></span>
                  <span class="block-menu__color-label">
                    {{ option.name }}
                    <span v-if="currentHorizontalRuleSize === option.value">(current)</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="panelState === 'dividerAlign'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Divider alignment</span>
          </div>
          <div class="block-menu__panel-scroll">
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Alignment</div>
              <div class="block-menu__color-list">
                <button
                  v-for="option in dividerAlignOptions"
                  :key="option.value"
                  class="block-menu__color-btn"
                  type="button"
                  :aria-label="'Divider alignment ' + option.name"
                  @click="setHorizontalRuleAlign(option.value)"
                >
                  <span class="block-menu__color-dot block-menu__color-dot--divider-align" :data-align="option.value"></span>
                  <span class="block-menu__color-label">
                    {{ option.name }}
                    <span v-if="currentHorizontalRuleAlign === option.value">(current)</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </template>
        <template v-else-if="panelState === 'code'">
          <div class="block-menu__panel-header">
            <button class="block-menu__back" type="button" @click.stop="openPanel('root')">‹ Back</button>
            <span class="block-menu__panel-title">Code block</span>
          </div>
          <div class="block-menu__panel-scroll">
            <div class="block-menu__group block-menu__submenu-section">
              <div class="block-menu__group-title">Language</div>
              <div class="block-menu__color-list">
                <button
                  v-for="lang in codeBlockLanguages"
                  :key="lang || 'plain'"
                  class="block-menu__color-btn"
                  type="button"
                  :aria-label="'Language ' + (lang || 'Plain text')"
                  @click="setCodeBlockLanguage(lang)"
                >
                  <span class="block-menu__color-dot"></span>
                  <span class="block-menu__color-label">
                    {{ lang || 'Plain text' }}
                    <span v-if="currentCodeLanguage === (lang || '')">(current)</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </transition>
  </div>
</template>
