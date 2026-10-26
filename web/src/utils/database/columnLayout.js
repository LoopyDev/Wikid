// Column sizes for the database table, and the measurements used to size columns to their content.

export const COLUMN_DEFAULT_SIZE = 180;

export const COLUMN_MIN_SIZE = 120;

export const COLUMN_MAX_SIZE = 1220;

export const ROW_ID_COLUMN_ID = '__row_id__';

export const ROW_ID_COLUMN_LABEL = 'Item ID';

export const ROW_ID_COLUMN_SIZE = 260;

export const ROW_ID_COLUMN_MIN_SIZE = 200;

export const ASSET_TAG_COLUMN_SIZE = 140;

export const ADD_COLUMN_ID = '__add_column__';

export const ADD_COLUMN_LABEL = 'Add';

export const ADD_COLUMN_SIZE = 120;

export const AUTO_SIZE_CHAR_LIMIT = 30;

export const AUTO_SIZE_CHAR_WIDTH = 8.5;

export const AUTO_SIZE_BASE = 26;

export const AUTO_SIZE_FIRST_EXTRA = 26;

export const AUTO_SIZE_PAGE_ICON_EXTRA = 30;

export const AUTO_SIZE_BUFFER = 8;

export const AUTO_SIZE_SELECT_PLACEHOLDER = 'Select...';

export const AUTO_SIZE_RELATION_PLACEHOLDER = 'Select record...';

export const AUTO_SIZE_RELATION_MULTI_PLACEHOLDER = 'Select records...';

export const AUTO_SIZE_MULTI_PLACEHOLDER = 'Add option';

export const AUTO_SIZE_MULTI_MEMBERS_PLACEHOLDER = 'Add person';

export const AUTO_SIZE_SELECT_EXTRA = 24;

export const AUTO_SIZE_MULTI_PILL_PADDING = 18;

export const AUTO_SIZE_MULTI_PILL_GAP = 6;

export const getFontForElement = (el) => {
  if (typeof window === 'undefined' || !el) return null;
  const style = window.getComputedStyle(el);
  if (style.font) return style.font;
  return `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
};
