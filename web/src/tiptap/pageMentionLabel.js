// What a mention shows for its page (from resolvePage): its title, or why there's none
export const mentionLabel = (page) => {
  if (!page) return 'Private page';
  if (page.isDeleted) return 'Deleted page';
  return page.title || 'Untitled page';
};
