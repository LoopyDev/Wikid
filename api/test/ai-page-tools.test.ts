import { describe, expect, it } from 'vitest';
import { AiPageTools, AiPageToolsAccess, AiPageToolsDb } from '../src/ai/ai-page-tools';

// A plain unit test (no database or model): the AI chat's page tools only show what the person can open.

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const pages = [
  { id: 'shared', title: 'Team plan', content: doc('Our plan for the year') },
  { id: 'mine', title: 'My plan', content: doc('My own notes') },
  { id: 'theirs', title: "Bob's plan", content: doc('Private salary notes') },
];

const toolsFor = (hidden: string[]) => {
  const db: AiPageToolsDb = {
    searchPages: async (_workspaceId, query) =>
      pages.filter((page) => `${page.title} ${JSON.stringify(page.content)}`.toLowerCase().includes(query.toLowerCase())),
    findPage: async (_workspaceId, pageId) => pages.find((page) => page.id === pageId) ?? null,
  };
  const access: AiPageToolsAccess = { listHiddenPageIds: async () => hidden };
  return new AiPageTools(db, access, { workspaceId: 'ws', userId: 'alice' });
};

describe("the AI chat's page tools", () => {
  it("don't find pages the person can't open", async () => {
    const tools = toolsFor(['theirs']);
    expect((await tools.searchPages('plan')).pages).toEqual([
      { id: 'shared', title: 'Team plan' },
      { id: 'mine', title: 'My plan' },
    ]);
    expect((await tools.searchPages('salary')).pages).toEqual([]);
  });

  it("don't read them, or name them while reading", async () => {
    const tools = toolsFor(['theirs']);
    expect(await tools.getPageContent('theirs')).toEqual({ error: 'Page not found' });
    expect(await tools.pageTitle('theirs')).toBe('a page');
    expect(await tools.getPageContent('mine')).toEqual({ id: 'mine', title: 'My plan', content: 'My own notes' });
    expect(await tools.pageTitle('shared')).toBe('Team plan');
  });

  it('show everything when nothing is hidden from the person', async () => {
    expect((await toolsFor([]).searchPages('plan')).pages).toHaveLength(3);
  });
});
