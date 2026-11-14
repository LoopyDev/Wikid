export type PageForAudience = { id: string; visibility: string; authorId: string | null };

/**
 * Who may be told that these pages changed, in groups: `null` is everyone in the workspace (pages
 * anyone there can see), a user id is a private page's author, the only one who can see it (viewers
 * never can; only a development-mode admin bypass reads others'). A page not found goes to no one:
 * what it was can't be known.
 */
export const groupPagesByAudience = (pageIds: string[], pages: PageForAudience[]) => {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const groups = new Map<string | null, string[]>();
  for (const id of pageIds) {
    const page = byId.get(id);
    if (!page) continue;
    const audience = page.visibility === 'PRIVATE' ? page.authorId : null;
    if (page.visibility === 'PRIVATE' && !audience) continue;
    groups.set(audience, [...(groups.get(audience) ?? []), id]);
  }
  return groups;
};
