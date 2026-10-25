import { isEmptyParagraph } from './editorShared';

// Content for blocks inserted from menus: columns, toggle headings and database views.

export const createDatabaseViewConfig = () => ({ type: 'table', filters: [], sorts: [], columns: null });

export const createColumnsPayload = (count) => {
  const safeCount = Math.max(2, Math.min(4, Number(count) || 2));
  const baseWidth = Math.round((100 / safeCount) * 10) / 10;
  const widths = Array.from({ length: safeCount }, (_, idx) => {
    if (idx === safeCount - 1) {
      const used = baseWidth * (safeCount - 1);
      return Math.round((100 - used) * 10) / 10;
    }
    return baseWidth;
  });
  return {
    type: 'columns',
    content: widths.map((width) => ({
      type: 'column',
      attrs: { width },
      content: [{ type: 'paragraph', content: [] }],
    })),
  };
};

export const createToggleHeadingPayload = (level) => ({
  type: 'toggleHeading',
  attrs: { collapsed: false },
  content: [
    { type: 'heading', attrs: { level }, content: [] },
    { type: 'paragraph', content: [] },
  ],
});

export const getColumnOnlyBlock = (columnNode, columnPos) => {
  if (!columnNode || columnNode.type?.name !== 'column') return null;
  if (columnNode.childCount !== 1) return null;
  const onlyChild = columnNode.child(0);
  return {
    node: onlyChild,
    pos: columnPos + 1,
    isEmpty: isEmptyParagraph(onlyChild),
  };
};
