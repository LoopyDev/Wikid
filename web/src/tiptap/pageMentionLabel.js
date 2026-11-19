/** A mention of a page, to put in at `pos`: a space after it unless one follows already. */
export const mentionContent = (doc, pos, pageId) => {
  const after = doc.textBetween(pos, Math.min(pos + 1, doc.content.size), ' ');
  return [{ type: 'pageMention', attrs: { pageId } }, ...(after === ' ' ? [] : [{ type: 'text', text: ' ' }])];
};

// What a mention shows for its page (from resolvePage): its title, or why there's none
export const mentionLabel = (page) => {
  if (!page) return 'Private page';
  if (page.isDeleted) return 'Deleted page';
  return page.title || 'Untitled page';
};
