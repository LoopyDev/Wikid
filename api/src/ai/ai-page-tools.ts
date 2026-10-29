// The AI chat's tools for finding and reading pages, for one person in one workspace: they only
// see the pages that person can open (not others' private pages, nor private pages for viewers),
// and never binned ones. Kept apart from the AI client so the rules can be unit tested.

type PageRow = { id: string; title: string | null; content?: unknown };

export type AiPageToolsDb = {
  // Pages whose title or content contains the text, newest first
  searchPages(workspaceId: string, query: string, limit: number): Promise<PageRow[]>;
  findPage(workspaceId: string, pageId: string): Promise<PageRow | null>;
};

export type AiPageToolsAccess = {
  // The pages in the workspace this person can't open
  listHiddenPageIds(workspaceId: string, userId: string): Promise<string[]>;
};

export function extractTextFromDoc(doc: any, maxLength = 5000): string {
  if (!doc || typeof doc !== 'object') return '';
  const parts: string[] = [];
  const blockTypes = new Set([
    'paragraph', 'heading', 'toggleHeading', 'blockquote',
    'codeBlock', 'listItem', 'taskItem', 'callout',
  ]);
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text') {
      parts.push(node.text || '');
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) visit(child);
    }
    if (blockTypes.has(node.type)) {
      parts.push('\n');
    }
  };
  if (Array.isArray(doc.content)) {
    doc.content.forEach(visit);
  } else {
    visit(doc);
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength);
}

const SEARCH_LIMIT = 8;
// Searched for more than are shown, as some may be pages this person can't open
const SEARCH_CANDIDATES = 50;

export class AiPageTools {
  private hidden: Promise<Set<string>> | null = null;

  constructor(
    private readonly db: AiPageToolsDb,
    private readonly access: AiPageToolsAccess,
    private readonly scope: { workspaceId: string; userId: string },
  ) {}

  private hiddenIds() {
    if (!this.hidden) {
      this.hidden = this.access.listHiddenPageIds(this.scope.workspaceId, this.scope.userId).then((ids) => new Set(ids));
    }
    return this.hidden;
  }

  private async openablePage(pageId: string) {
    if (!pageId) return null;
    const [page, hidden] = await Promise.all([this.db.findPage(this.scope.workspaceId, pageId), this.hiddenIds()]);
    return page && !hidden.has(page.id) ? page : null;
  }

  async searchPages(query: string) {
    if (!query.trim()) return { pages: [] };
    const [found, hidden] = await Promise.all([
      this.db.searchPages(this.scope.workspaceId, query, SEARCH_CANDIDATES),
      this.hiddenIds(),
    ]);
    const pages = found.filter((page) => !hidden.has(page.id)).slice(0, SEARCH_LIMIT);
    return { pages: pages.map((page) => ({ id: page.id, title: page.title || 'Untitled' })) };
  }

  async getPageContent(pageId: string) {
    const page = await this.openablePage(pageId);
    if (!page) return { error: 'Page not found' };
    return { id: page.id, title: page.title || 'Untitled', content: extractTextFromDoc(page.content) };
  }

  // The title shown while the chat reads a page: only for pages this person can open
  async pageTitle(pageId: string) {
    const page = await this.openablePage(pageId);
    return page ? page.title || 'Untitled' : 'a page';
  }
}
