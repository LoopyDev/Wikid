// A page dragged from the sidebar: its id and title, under a type of Wikid's own, so the editor can
// tell it from anything else dropped on it
export const SIDEBAR_PAGE_TYPE = 'application/x-wikid-page';

/** The sidebar page being dropped ({ id, title, workspaceId }), or null if the drop is something else. */
export function sidebarPageIn(dataTransfer) {
  if (!dataTransfer?.types || !Array.from(dataTransfer.types).includes(SIDEBAR_PAGE_TYPE)) return null;
  try {
    const page = JSON.parse(dataTransfer.getData(SIDEBAR_PAGE_TYPE));
    return typeof page?.id === 'string' && page.id ? { id: page.id, title: String(page.title || ''), workspaceId: page.workspaceId ?? null } : null;
  } catch {
    return null;
  }
}
