import { h } from 'vue';
import PageIcon from '../components/PageIcon.vue';
import { AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER, AUTO_SIZE_MULTI_PLACEHOLDER, AUTO_SIZE_RELATION_MULTI_PLACEHOLDER, AUTO_SIZE_RELATION_PLACEHOLDER, AUTO_SIZE_SELECT_PLACEHOLDER } from '../utils/database/columnLayout';
import { formatDateTime } from '../utils/date-format';
import { getAssetTagValue, getMultiSelectValues, getRelationEntries, valueForField } from '../utils/database/cellValues';
import { getRelationConfig, isAssetTagField, isFieldReadOnly, isLastEditedField, isLinkedFromField, isMembersField, isPageField, isPageFieldEditable } from '../utils/database/fieldOptions';
import { handleCellConfirmKeydown, handleNumberKeydown, handleNumberPaste, sanitizeNumberInput } from '../utils/database/cellInput';
import { multiSelectPillStyle } from '../utils/database/colors';

// Draws a table cell for its field type: text, number, date, checkbox, select and multi-select
// pills, relations, members, asset tags, page titles (with their page link) and read-only values,
// with the editing caret and who-is-here presence.
export function useCellRenderer({ choiceColorForValue, getChoiceLabel, isReadonly, markCellFocus, markCellBlur, openMultiSelectMenu, getCellPresence, caretLeftForCell, openAssetTagPreview, rowPageId, getRowPageTitle, openRowPageOverlay, pageMap, workspace, resolveRowPage, ensureRowPage, applyLocalPageTitleUpdate, schedulePageTitleUpdate, tableWrapRef, pendingEnsureRowPages, scheduleSortRefresh, handleCaretNavigate, handleCaretMouse, markCellTyping, updateCell, setCellInputRef, resolveRowLastEdited, relationOptionsByPageId, relationOptionsLoading, loadRelationOptions, relationOptionsForPage, relationOptionsLoadingForPage, relationOptionsErrorForPage, getFieldChoices, linkedRowsFor, getRelationLabel, openRelatedRow }) {
  const renderMultiSelectCell = (row, field) => {
    const values = getMultiSelectValues(row, field);
    const placeholder =
      field.type === 'RELATION'
        ? AUTO_SIZE_RELATION_MULTI_PLACEHOLDER
        : isMembersField(field)
        ? AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER
        : AUTO_SIZE_MULTI_PLACEHOLDER;
    const pills = values.length
      ? values.map((value) =>
          h(
            'span',
            {
              key: value,
              class: 'db-multi-pill',
              style: multiSelectPillStyle(choiceColorForValue(field, value)),
            },
            getChoiceLabel(field, value)
          )
        )
      : [h('span', { class: 'db-multi-placeholder' }, placeholder)];
    return h(
      'button',
      {
        class: 'db-multi-cell',
        type: 'button',
        disabled: isReadonly.value || isFieldReadOnly(field),
        onFocus: (event) => markCellFocus(row.id, field.id, event.target),
        onBlur: () => markCellBlur(),
        onClick: (event) => openMultiSelectMenu(row, field, event),
      },
      pills
    );
  };
  // A relation: the rows it links to as pills, each opening that row's page, and a button to
  // change them. Empty, the whole cell chooses one.
  const renderRelationCell = (row, field, cellDisabled) => {
    const relation = getRelationConfig(field);
    if (relation?.pageId && !relationOptionsByPageId.value[relation.pageId] && !relationOptionsLoading.value[relation.pageId]) {
      void loadRelationOptions(relation.pageId);
    }
    const entries = getRelationEntries(row, field).filter((entry) => entry?.id);
    const canChange = !cellDisabled && !!relation?.pageId;
    const choose = (event) => {
      event.stopPropagation();
      openMultiSelectMenu(row, field, event);
    };
    if (!entries.length) {
      const loading = relation?.pageId ? relationOptionsLoadingForPage(relation.pageId) : false;
      const loadError = relation?.pageId ? relationOptionsErrorForPage(relation.pageId) : '';
      const placeholder = loadError ? 'Failed to load' : loading ? 'Loading...' : relation?.allowMultiple ? AUTO_SIZE_RELATION_MULTI_PLACEHOLDER : AUTO_SIZE_RELATION_PLACEHOLDER;
      return h(
        'button',
        {
          class: 'db-multi-cell db-relation-cell',
          type: 'button',
          disabled: !canChange,
          onFocus: (event) => markCellFocus(row.id, field.id, event.target),
          onBlur: () => markCellBlur(),
          onClick: choose,
          ref: setCellInputRef(row.id, field.id),
        },
        [h('span', { class: 'db-multi-placeholder' }, canChange ? placeholder : '—')]
      );
    }
    return h('div', { class: 'db-multi-cell db-relation-cell db-relation-cell--set' }, [
      ...entries.map((entry) => {
        const label = getRelationLabel(field, entry) || entry.id;
        return h(
          'button',
          {
            key: entry.id,
            class: 'db-multi-pill db-relation-pill',
            type: 'button',
            title: `Open ${label}`,
            onClick: (event) => {
              event.stopPropagation();
              void openRelatedRow(field, entry.id);
            },
          },
          label
        );
      }),
      canChange
        ? h(
            'button',
            {
              class: 'db-relation-change',
              type: 'button',
              'aria-label': `Change ${field.name || 'relation'}`,
              title: 'Change',
              onFocus: (event) => markCellFocus(row.id, field.id, event.target),
              onBlur: () => markCellBlur(),
              onClick: choose,
              ref: setCellInputRef(row.id, field.id),
            },
            '▾'
          )
        : null,
    ]);
  };

  const renderCellInput = (row, field) => {
    const presence = getCellPresence(row.id, field.id);
    const typing = presence.find((entry) => entry.mode === 'typing');
    const primary = typing || presence[0] || null;
    const cellValue = valueForField(row, field);
    const targetPresence = typing || primary;
    const targetValue = targetPresence?.value ?? cellValue;
    const measuredLeft =
      targetPresence && Number.isFinite(targetPresence.offset)
        ? caretLeftForCell(row.id, field.id, targetPresence.offset, targetValue)
        : null;
    const caretLeft =
      Number.isFinite(measuredLeft)
        ? measuredLeft
        : targetPresence && Number.isFinite(targetPresence.caretLeft)
          ? targetPresence.caretLeft
          : null;
    const isReadOnlyCell = isFieldReadOnly(field);
    const cellDisabled = isReadonly.value || isReadOnlyCell;
    const presenceWrap = (node) =>
      h(
        'div',
        {
          class: [
            'db-cell',
            presence.length ? 'db-cell--presence' : '',
            typing ? 'db-cell--typing' : '',
            isReadOnlyCell ? 'db-cell--readonly' : '',
          ],
          style: primary
            ? {
                '--presence-color': primary.color,
                '--presence-caret-left': caretLeft ? `${caretLeft}px` : undefined,
              }
            : {},
        },
        [
          presence.length
            ? h('div', { class: 'db-cell-presence' })
            : null,
          node,
        ]
      );
    if (isAssetTagField(field)) {
      const value = getAssetTagValue(row, field);
      return presenceWrap(
        h(
          'button',
          {
            class: 'db-qr-btn',
            type: 'button',
            disabled: !value,
            title: value || '',
            'aria-label': 'View asset tag QR',
            onClick: (event) => {
              event?.stopPropagation?.();
              openAssetTagPreview(value);
            },
          },
          [h('i', { class: 'bi bi-qr-code', 'aria-hidden': 'true' })]
        )
      );
    }
    if (isPageField(field)) {
      const pageId = rowPageId(row);
      const rawTitle = valueForField(row, field);
      // For the read-only branch we need the full title; for the editable branch
      // we defer pageMap reads to event handlers. getTitle() is called lazily.
      const getTitle = () => getRowPageTitle(row, field) || 'Untitled page';
      const openRowPage = (pageOrId) => {
        if (typeof openRowPageOverlay === 'function') {
          openRowPageOverlay(pageOrId);
          return;
        }
        if (typeof pageOrId === 'string') {
          const stored = pageMap.value.get(pageOrId) || null;
          if (stored) {
            workspace.selectPage(stored, { allowHidden: true });
            return;
          }
          if (workspace.hasApi) {
            workspace.loadPageDoc(pageOrId);
          }
          return;
        }
        if (pageOrId) {
          workspace.selectPage(pageOrId, { allowHidden: true });
        }
      };
      const handleOpen = async () => {
        const page = resolveRowPage(row);
        if (page || pageId) {
          openRowPage(page || pageId);
          return;
        }
        if (isReadonly.value) return;
        const targetPage = await ensureRowPage(row, { title: getTitle() });
        if (targetPage) {
          openRowPage(targetPage);
        }
      };
      if (!isPageFieldEditable(field)) {
        const page = resolveRowPage(row);
        const title = getTitle();
        const allowMissingOpen = !isReadonly.value;
        return presenceWrap(
          h('div', { class: ['db-page-link', page ? '' : 'db-page-link--missing'] }, [
            h(
              'div',
              {
                class: 'db-page-link__main',
              },
              [
                h(PageIcon, { class: 'db-page-link__icon', icon: page?.icon, fallback: '📄', 'aria-hidden': 'true' }),
                h('span', { class: 'db-page-link__title' }, title),
              ]
            ),
            h(
              'button',
              {
                class: 'db-page-link__action',
                type: 'button',
                disabled: !page && !allowMissingOpen,
                onClick: handleOpen,
              },
              'Open'
            ),
          ])
        );
      }
      // Editable page field: avoid reading pageMap / workspace.pages here.
      // Any reactive read causes Vue to re-render this cell when pages change,
      // which destroys the focused <input> and drops focus. Page lookups are
      // deferred to event handlers (handleOpen) which run outside the render.
      return presenceWrap(
        h('div', { class: 'db-page-input' }, [
          h(
            'button',
            {
              class: 'db-page-input__open',
              type: 'button',
              disabled: !pageId && (isReadonly.value || isFieldReadOnly(field)),
              onClick: handleOpen,
            },
            [h(PageIcon, { class: 'db-page-input__icon', icon: row.icon ?? null, fallback: '📄', 'aria-hidden': 'true' })]
          ),
          h('input', {
            class: 'db-cell-input db-page-input__field',
            type: 'text',
            value: rawTitle,
            disabled: cellDisabled,
            onKeydown: handleCellConfirmKeydown,
            onFocus: (event) => markCellFocus(row.id, field.id, event.target),
            onBlur: (event) => {
              markCellBlur();
              const nextTitle = event?.target?.value;
              const pageId = rowPageId(row);
              // Defer all side effects so the browser settles focus before we
              // trigger any reactive re-renders.
              requestAnimationFrame(() => requestAnimationFrame(() => {
                if (pageId) {
                  applyLocalPageTitleUpdate(pageId, nextTitle ?? '');
                  schedulePageTitleUpdate(pageId, nextTitle ?? '');
                }
                // Defer ensureRowPage while focus is in the table — its API
                // response calls workspace.upsertPage() which triggers a
                // re-render that destroys the newly focused input.
                if (pageId || (typeof nextTitle === 'string' && nextTitle.trim())) {
                  const active = document.activeElement;
                  const focusInTable = active && tableWrapRef.value?.contains(active);
                  if (focusInTable) {
                    pendingEnsureRowPages.push({ row, options: { title: nextTitle } });
                  } else {
                    ensureRowPage(row, { title: nextTitle });
                  }
                }
                scheduleSortRefresh();
              }));
            },
            onKeyup: (event) => handleCaretNavigate(row.id, field.id, event),
            onMouseup: (event) => handleCaretMouse(row.id, field.id, event),
            onInput: (event) => {
              markCellTyping(row.id, field.id, event.target);
              updateCell(row, field, event.target.value, { deferSort: true });
            },
            ref: setCellInputRef(row.id, field.id),
          }),
          h(
            'button',
            {
              class: 'db-page-link__action',
              type: 'button',
              disabled: isReadonly.value || isFieldReadOnly(field),
              onClick: handleOpen,
            },
            'Open'
          ),
        ])
      );
    }
    if (isLinkedFromField(field)) {
      // Rows elsewhere linking to this one: shown here, changed there
      const linked = linkedRowsFor?.(field.id, row.id) || [];
      if (!linked.length) return presenceWrap(h('span', { class: 'db-readonly-cell' }, '—'));
      return presenceWrap(
        h(
          'div',
          { class: 'db-multi-cell db-linked-cell' },
          linked.map((entry) =>
            entry.rowPageId
              ? h(
                  'button',
                  {
                    key: entry.rowId,
                    class: 'db-multi-pill db-linked-pill',
                    type: 'button',
                    title: `Open ${entry.title}`,
                    onClick: (event) => {
                      event.stopPropagation();
                      openRowPageOverlay(entry.rowPageId);
                    },
                  },
                  entry.title
                )
              : h('span', { key: entry.rowId, class: 'db-multi-pill' }, entry.title)
          )
        )
      );
    }
    if (isLastEditedField(field)) {
      const label = formatDateTime(resolveRowLastEdited(row));
      return presenceWrap(h('span', { class: 'db-readonly-cell' }, label || '—'));
    }
    if (field.type === 'CHECKBOX') {
      return presenceWrap(
        h('input', {
        class: 'db-cell-input',
        type: 'checkbox',
        checked: !!row.data?.[field.id],
        disabled: cellDisabled,
        onFocus: (event) => markCellFocus(row.id, field.id, event.target),
        onBlur: () => markCellBlur(),
        onChange: (event) => updateCell(row, field, event.target.checked),
      })
      );
    }
    if (field.type === 'DATE') {
      return presenceWrap(
        h('input', {
          class: 'db-cell-input',
          type: 'date',
          value: valueForField(row, field),
          disabled: cellDisabled,
          onKeydown: handleCellConfirmKeydown,
          onFocus: (event) => markCellFocus(row.id, field.id, event.target),
          onBlur: () => markCellBlur(),
          onChange: (event) => updateCell(row, field, event.target.value),
          ref: setCellInputRef(row.id, field.id),
        })
      );
    }
    if (field.type === 'NUMBER') {
      return presenceWrap(
        h('input', {
          class: 'db-cell-input',
          type: 'text',
        inputmode: 'decimal',
        pattern: '^-?\\d*\\.?\\d*$',
          step: 'any',
          value: valueForField(row, field),
          disabled: cellDisabled,
          onKeydown: (event) => {
            handleNumberKeydown(event);
            handleCellConfirmKeydown(event);
          },
          onKeyup: (event) => handleCaretNavigate(row.id, field.id, event),
          onMouseup: (event) => handleCaretMouse(row.id, field.id, event),
          onPaste: handleNumberPaste,
          onFocus: (event) => markCellFocus(row.id, field.id, event.target),
          onInput: (event) => {
            const cleaned = sanitizeNumberInput(event.target.value);
            if (event.target.value !== cleaned) {
              event.target.value = cleaned;
            }
            markCellTyping(row.id, field.id, event.target);
            updateCell(row, field, cleaned, { raw: true, deferSort: true });
          },
          onBlur: (event) => {
            const cleaned = sanitizeNumberInput(event.target.value);
            if (event.target.value !== cleaned) {
              event.target.value = cleaned;
              updateCell(row, field, cleaned, { deferSort: true });
            }
            markCellBlur();
            scheduleSortRefresh();
          },
          ref: setCellInputRef(row.id, field.id),
        })
      );
    }
    if (field.type === 'RELATION') {
      return presenceWrap(renderRelationCell(row, field, cellDisabled));
    }
    if (field.type === 'SELECT') {
      const choices = getFieldChoices(field);
      return presenceWrap(
        h(
          'select',
          {
            class: 'db-cell-input',
            value: valueForField(row, field),
            disabled: cellDisabled,
            onFocus: (event) => markCellFocus(row.id, field.id, event.target),
            onBlur: () => markCellBlur(),
            onChange: (event) => updateCell(row, field, event.target.value),
            ref: setCellInputRef(row.id, field.id),
          },
          [
            h('option', { value: '' }, AUTO_SIZE_SELECT_PLACEHOLDER),
            ...choices.map((option) => h('option', { key: option.value, value: option.value }, option.label || option.value)),
          ]
        )
      );
    }
    if (field.type === 'MULTI_SELECT') {
      return presenceWrap(renderMultiSelectCell(row, field));
    }
    return presenceWrap(
      h('input', {
        class: 'db-cell-input db-cell-input--text',
        type: field.type === 'URL' ? 'url' : 'text',
        value: valueForField(row, field),
        disabled: cellDisabled,
        onKeydown: handleCellConfirmKeydown,
        onKeyup: (event) => handleCaretNavigate(row.id, field.id, event),
        onMouseup: (event) => handleCaretMouse(row.id, field.id, event),
        onFocus: (event) => markCellFocus(row.id, field.id, event.target),
        onInput: (event) => {
          markCellTyping(row.id, field.id, event.target);
          updateCell(row, field, event.target.value, { deferSort: true });
        },
        onBlur: () => {
          markCellBlur();
          scheduleSortRefresh();
        },
        ref: setCellInputRef(row.id, field.id),
      })
    );
  };

  return { renderCellInput };
}
