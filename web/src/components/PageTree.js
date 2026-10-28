import { computed, defineComponent, Fragment, h, ref, Teleport } from 'vue';
import PageIcon from './PageIcon.vue';
import { CHEVRON_RIGHT } from '../constants/icons';

// The sidebar's page tree: one row per page, with drag-and-drop reordering and the page menu.
export default defineComponent({
  name: 'PageTree',
  props: {
    pages: { type: Array, required: true },
    parentId: { type: String, default: null },
    depth: { type: Number, default: 0 },
    activeId: { type: String, default: null },
    menuOpenFor: { type: [String, null], default: null },
    canEdit: { type: Boolean, default: true },
    isExpanded: { type: Function, required: true },
    toggleExpand: { type: Function, required: true },
    select: { type: Function, required: true },
    toggleMenu: { type: Function, required: true },
    duplicate: { type: Function, required: true },
    rename: { type: Function, required: true },
    moveVisibility: { type: Function, required: true },
    remove: { type: Function, required: true },
    exportHtml: { type: Function, required: false },
    addChild: { type: Function, required: true },
    toggleTree: { type: Function, required: true },
    convertToWiki: { type: Function, required: false },
    openInSplit: { type: Function, required: false },
    openInMoveWorkspace: { type: Function, required: false },
    onReorder: { type: Function, required: false },
    // Called with a page the pointer has rested on, to start loading it before the click
    prefetch: { type: Function, required: false },
    indentStep: { type: Number, default: 16 },
  },
  setup(props) {
    const suppressClickUntil = ref(0);
    const suppressClickAfterDrag = () => {
      suppressClickUntil.value = Date.now() + 300;
    };
    const shouldSuppressClick = () => Date.now() < suppressClickUntil.value;
    const childrenMap = computed(() => {
      const map = new Map();
      props.pages.forEach((page) => {
        const parentId = page.parentId ?? null;
        if (!map.has(parentId)) {
          map.set(parentId, []);
        }
        map.get(parentId).push(page);
      });
      // keep children ordered by their position so tree reflects reorder immediately
      for (const [key, list] of map.entries()) {
        map.set(
          key,
          [...list].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
        );
      }
      return map;
    });

    const childrenOf = (parentId) => childrenMap.value.get(parentId ?? null) ?? [];

    const collectDescendants = (rootId) => {
      const stack = [rootId];
      const descendants = [];
      while (stack.length) {
        const currentId = stack.pop();
        const children = childrenOf(currentId);
        children.forEach((child) => {
          descendants.push(child.id);
          stack.push(child.id);
        });
      }
      return descendants;
    };

    const isSubtreeFullyExpanded = (rootId) => {
      const descendants = collectDescendants(rootId);
      return descendants.length > 0 && descendants.every((id) => props.isExpanded(id));
    };

    const renderNode = (page, depth) => {
          const isOpen = props.isExpanded(page.id);
          const children = childrenOf(page.id);
          const subtreeFullyExpanded = isSubtreeFullyExpanded(page.id);
          const treeActionLabel = subtreeFullyExpanded ? 'Collapse all' : 'Expand all';
      const isDragging = ref(false);
      const isDragOver = ref(false);
      const dropMode = ref('none'); // 'into' or 'above'
          const handleTreeAction = (event) => {
            event.stopPropagation();
            props.toggleTree(page, props.pages, subtreeFullyExpanded);
          };

      const handleDragStart = (event) => {
        if (!props.canEdit || !props.onReorder) return;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/json', JSON.stringify({ id: page.id, parentId: page.parentId ?? null }));
        isDragging.value = true;
    };

      const handleDragEnd = () => {
        isDragging.value = false;
        isDragOver.value = false;
        if (typeof document !== 'undefined') {
          document.querySelectorAll('.drag-over').forEach((el) => {
            el.classList.remove('drag-over');
            el.removeAttribute('data-dragover');
            el.removeAttribute('data-drop-mode');
          });
        }
      };

      const handleDragOver = (event) => {
        if (!props.onReorder || !props.canEdit) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        isDragOver.value = true;
        if (event.currentTarget) {
          event.currentTarget.classList.add('drag-over');
          event.currentTarget.setAttribute('data-dragover', 'true');
          const rect = event.currentTarget.getBoundingClientRect();
          const offsetY = event.clientY - rect.top;
          const ratio = rect.height ? offsetY / rect.height : 0.5;
          // top edge = above, everything else = into (prevents bottom edge misclassifying as above)
          const nextMode = ratio <= 0.2 ? 'above' : 'into';
          dropMode.value = nextMode;
          event.currentTarget.setAttribute('data-drop-mode', nextMode);
        }
      };

      const clearDragVisual = (targetEl) => {
        if (targetEl?.classList) {
          targetEl.classList.remove('drag-over');
        }
        if (targetEl?.removeAttribute) {
          targetEl.removeAttribute('data-dragover');
          targetEl.removeAttribute('data-drop-mode');
        }
      };

      const handleDragLeave = (event) => {
        isDragOver.value = false;
        dropMode.value = 'none';
        clearDragVisual(event?.currentTarget);
      };

      const handleDrop = (event) => {
        if (!props.onReorder || !props.canEdit) return;
        event.preventDefault();
        // Recompute mode on drop in case dragleave fired before drop
        const el = event.currentTarget;
        if (el) {
          const rect = el.getBoundingClientRect();
          const offsetY = event.clientY - rect.top;
          const ratio = rect.height ? offsetY / rect.height : 0.5;
          const nextMode = ratio <= 0.2 ? 'above' : 'into';
          dropMode.value = nextMode;
          el.setAttribute('data-drop-mode', nextMode);
        }
        try {
          const data = JSON.parse(event.dataTransfer.getData('application/json'));
        if (data?.id && data.id !== page.id) {
          props.onReorder({
            draggedId: data.id,
            targetId: page.id,
            targetParentId: page.parentId ?? null,
            dropMode: dropMode.value === 'into' ? 'into' : 'above',
          });
        }
        } catch {
          // ignore malformed drops
        }
        suppressClickAfterDrag();
        isDragOver.value = false;
        dropMode.value = 'none';
        clearDragVisual(event?.currentTarget);
      };

      const row = h(
        'div',
        {
          class: ['sidebar__item', { active: page.id === props.activeId, 'menu-open': props.menuOpenFor === page.id }],
          'data-depth': depth,
          'data-dragging': isDragging.value ? 'true' : 'false',
          'data-dragover': isDragOver.value ? 'true' : 'false',
          'data-drop-mode': dropMode.value,
          onClick: () => {
            if (shouldSuppressClick()) return;
            props.select(page);
          },
          style: { '--sidebar-item-indent': `${depth * props.indentStep}px` },
          draggable: !!props.onReorder,
          ...(props.canEdit ? {} : { draggable: false }),
          onDragstart: handleDragStart,
          onDragend: handleDragEnd,
          onDragover: handleDragOver,
          onDragleave: handleDragLeave,
          onDrop: handleDrop,
          onMouseenter: (e) => {
            const itemEl = e.currentTarget;
            // Only once the pointer rests here, so sweeping down the sidebar doesn't load every page
            clearTimeout(itemEl._prefetchTimer);
            if (props.prefetch && page.id !== props.activeId) {
              itemEl._prefetchTimer = setTimeout(() => props.prefetch(page), 150);
            }
            if (itemEl._collapseTimer) {
              clearTimeout(itemEl._collapseTimer);
              itemEl._collapseTimer = null;
            }
            // highlight all items in the same tree branch
            const itemDepth = parseInt(itemEl.dataset.depth) || 0;
            const treeItems = [];
            let root = itemDepth === 0 ? itemEl : null;
            if (!root) {
              let sib = itemEl.previousElementSibling;
              while (sib) {
                if (sib.classList.contains('sidebar__item') && (parseInt(sib.dataset.depth) || 0) === 0) {
                  root = sib;
                  break;
                }
                sib = sib.previousElementSibling;
              }
            }
            if (root) {
              if (root !== itemEl) treeItems.push(root);
              let sib = root.nextElementSibling;
              while (sib && sib.classList.contains('sidebar__item')) {
                if ((parseInt(sib.dataset.depth) || 0) === 0) break;
                if (sib !== itemEl) treeItems.push(sib);
                sib = sib.nextElementSibling;
              }
            }
            treeItems.forEach(el => el.classList.add('tree-hovered'));
            itemEl._treeHoveredItems = treeItems;
          },
          onMouseleave: (e) => {
            const itemEl = e.currentTarget;
            clearTimeout(itemEl._prefetchTimer);
            itemEl._collapseTimer = setTimeout(() => {
              (itemEl._treeHoveredItems || []).forEach(el => el.classList.remove('tree-hovered'));
              itemEl._treeHoveredItems = null;
              itemEl._collapseTimer = null;
            }, 300);
          },
        },
        [
          h(
            'div',
            { class: 'page-icon-slot' },
            [
              h(PageIcon, { class: 'page-icon', icon: page.icon, fallback: '📄', 'aria-hidden': 'true' }),
            h(
              'button',
              {
                class: ['page-chevron', { open: isOpen }],
                onClick: (e) => {
                  e.stopPropagation();
                  props.toggleExpand(page.id);
                },
              },
              h(
                'svg',
                {
                  class: 'chevron-icon',
                  viewBox: '0 0 16 16',
                  width: 16,
                  height: 16,
                  fill: 'currentColor',
                  'aria-hidden': 'true',
                },
                [h('path', { 'fill-rule': 'evenodd', d: CHEVRON_RIGHT })]
              )
            ),
          ]),
          h('div', { class: 'sidebar__title' }, page.title || 'Untitled page'),
          props.canEdit
            ? h('div', { class: 'page-actions' }, [
                h('button', {
                  class: 'page-add-btn',
                  onClick: (e) => {
                    e.stopPropagation();
                    props.addChild(page);
                    e.currentTarget?.blur?.();
                  },
                }, '+'),
                h('div', { class: 'page-menu-wrapper', 'data-menu-for': page.id }, [
                  h('button', {
                    class: 'page-menu-btn',
                    onClick: (e) => {
                      e.stopPropagation();
                      props.toggleMenu(page.id);
                      e.currentTarget?.blur?.();
                    },
                  }, '...'),
                  // Drawn on <body>, next to the button: the sidebar scrolls, so it would clip the menu.
                  props.menuOpenFor === page.id
                    ? h(Teleport, { to: 'body' }, h('div', {
                        class: 'page-menu context-menu',
                        onVnodeMounted(vnode) {
                          const el = vnode.el;
                          const button = document.querySelector(`.page-menu-wrapper[data-menu-for="${page.id}"]`);
                          if (!el || !button) return;
                          const anchor = button.getBoundingClientRect();
                          const menu = el.getBoundingClientRect();
                          const margin = 8;
                          const left = Math.min(anchor.right + 6, window.innerWidth - menu.width - margin);
                          const top = Math.min(anchor.bottom + margin, window.innerHeight - menu.height - margin);
                          el.style.left = `${Math.max(margin, left)}px`;
                          el.style.top = `${Math.max(margin, top)}px`;
                        },
                      }, [
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.duplicate(page); } }, 'Duplicate'),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.rename(page); } }, 'Rename'),
                        props.openInSplit
                          ? h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.openInSplit(page.id); props.toggleMenu(null); } }, 'Open in split')
                          : null,
                        props.openInMoveWorkspace
                          ? h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.openInMoveWorkspace(page); props.toggleMenu(null); } }, 'Move to workspace…')
                          : null,
                        props.convertToWiki && page.kind !== 'DATABASE' && !page.isHidden && page.wikiHomeId !== page.id
                          ? h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.convertToWiki(page); } }, 'Turn into wiki')
                          : null,
                        h(
                          'button',
                          {
                            type: 'button',
                            class: 'context-menu__item',
                            onClick: (e) => {
                              e.stopPropagation();
                              props.moveVisibility(page);
                            },
                          },
                          page.visibility === 'PRIVATE' ? 'Move to public' : 'Move to private'
                        ),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.exportHtml(page); } }, 'Export'),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: (e) => { e.stopPropagation(); props.remove(page); } }, 'Delete'),
                        h('button', { type: 'button', class: 'context-menu__item', onClick: handleTreeAction }, treeActionLabel),
                      ]))
                    : null,
                ]),
              ])
            : null,
        ]
      );

      const childrenNodes = isOpen
        ? children.length
          ? children.map((child) => renderNode(child, depth + 1))
          : [h('div', { class: 'page-empty', style: { paddingLeft: `${(depth + 1) * 12}px` } }, 'No pages inside')]
        : [];

      return h(Fragment, null, [row, ...childrenNodes]);
    };

    return () => childrenOf(props.parentId).map((page) => renderNode(page, props.depth));
  },
});
