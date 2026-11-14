// What a page template may hold: content that means the same in any workspace. Images belong to
// the workspace they were uploaded in, and database views and forms, page links and synced blocks
// point at pages there, so a template holds none of them. Pure, so it's unit tested on its own.

export type ContentNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ContentNode[];
  text?: string;
  marks?: unknown[];
};

/** What was changed to make content fit a template, to tell the person. */
export type TemplateCleanup = {
  /** Images, now image placeholders saying what they showed */
  images: number;
  /** Left out: they point at pages or files in one workspace */
  databaseViews: number;
  databaseForms: number;
  pageLinks: number;
  splats: number;
};

export const emptyCleanup = (): TemplateCleanup => ({ images: 0, databaseViews: 0, databaseForms: 0, pageLinks: 0, splats: 0 });

const LEFT_OUT: Record<string, keyof TemplateCleanup> = {
  databaseView: 'databaseViews',
  databaseForm: 'databaseForms',
  pageLink: 'pageLinks',
  // (A mention of a page here: counted with the page links)
  pageMention: 'pageLinks',
  gaussianSplat: 'splats',
};

// Blocks that must hold at least one block
const NEEDS_CONTENT = new Set(['callout', 'column', 'blockquote', 'listItem', 'taskItem', 'tableCell', 'tableHeader']);

const imageText = (node: ContentNode) => {
  const text = [node.attrs?.alt, node.attrs?.title].find((value) => typeof value === 'string' && value.trim());
  return typeof text === 'string' ? text.trim() : '';
};

function clean(nodes: ContentNode[] | undefined, cleanup: TemplateCleanup): ContentNode[] {
  const out: ContentNode[] = [];
  for (const node of nodes ?? []) {
    if (LEFT_OUT[node.type]) {
      cleanup[LEFT_OUT[node.type]] += 1;
      continue;
    }
    if (node.type === 'image') {
      cleanup.images += 1;
      const text = imageText(node);
      out.push({ type: 'imagePlaceholder', ...(node.attrs?.id ? { attrs: { id: node.attrs.id } } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) });
      continue;
    }
    const next: ContentNode = { ...node };
    // A synced block's copy: just its content here
    if (next.attrs && 'syncedFrom' in next.attrs) next.attrs = { ...next.attrs, syncedFrom: null };
    if (node.content) {
      next.content = clean(node.content, cleanup);
      if (!next.content.length && NEEDS_CONTENT.has(node.type)) next.content = [{ type: 'paragraph' }];
      // A column or columns block left with nothing: left out too
      if (!next.content.length && (node.type === 'columns' || node.type === 'table' || node.type === 'tableRow')) continue;
    }
    out.push(next);
  }
  return out;
}

/** Content made fit for a template, and what was changed to make it so. */
export function templateContent(content: ContentNode[], cleanup: TemplateCleanup = emptyCleanup()) {
  const cleaned = clean(content, cleanup);
  return { content: cleaned.length ? cleaned : [{ type: 'paragraph' }], cleanup };
}

/** "2 images became image placeholders; 1 database view was left out." */
export function describeCleanup(cleanup: TemplateCleanup): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const notes: string[] = [];
  if (cleanup.images === 1) notes.push('1 image became an image placeholder, saying what it showed');
  else if (cleanup.images) notes.push(`${cleanup.images} images became image placeholders, saying what they showed`);
  const left = [
    cleanup.databaseViews && plural(cleanup.databaseViews, 'database view', 'database views'),
    cleanup.databaseForms && plural(cleanup.databaseForms, 'database form', 'database forms'),
    cleanup.pageLinks && plural(cleanup.pageLinks, 'page link', 'page links'),
    cleanup.splats && plural(cleanup.splats, 'Gaussian splat', 'Gaussian splats'),
  ].filter(Boolean);
  if (left.length) notes.push(`Left out, as they belong to one workspace: ${left.join(', ')}`);
  return notes;
}
