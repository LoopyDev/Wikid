import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PageKind, PageVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PageAccessService } from '../pages/page-access.service';
import { PageContentService } from '../pages/page-content.service';
import { PagesService } from '../pages/pages.service';
import { markdownToContent } from '../pages/markdown/markdown-to-content.util';
import { BUILTIN_PREFIX, BUILTIN_TEMPLATES, findBuiltinTemplate } from './builtin-templates';
import { describeCleanup, emptyCleanup, templateContent, type ContentNode, type TemplateCleanup } from './template-content.util';

type User = { userId?: string; userName?: string };
type Scope = 'workspace' | 'personal';

/** A page and the pages under it, as copied to or from a template. */
type Tree = { title: string; icon: string | null; content: ContentNode[]; children: Tree[] };

// Page templates. A template is a page marked as one: a workspace's live in that workspace, for its
// members; someone's own live in their personal workspace, and are offered in every workspace.
// Using one copies it (and its subpages) into new pages; making one from a page copies that, with
// its content made fit for any workspace (template-content.util.ts).
@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly pages: PagesService,
    private readonly pageContent: PageContentService,
  ) {}

  private requireUser(user: User) {
    if (!user.userId) throw new BadRequestException('userId is required');
    return user as { userId: string; userName?: string };
  }

  private async personalWorkspaceId(user: User) {
    const { userId, userName } = this.requireUser(user);
    return (await this.access.ensureDefaultWorkspaces(userId, userName)).personalWorkspace.id;
  }

  /** The templates offered in a workspace: its own, the person's own, and the built-in ones. */
  async list(workspaceId: string | undefined, user: User) {
    if (!workspaceId) throw new BadRequestException('workspaceId is required');
    await this.access.ensureWorkspaceReadAccess(workspaceId, user);
    const personalId = await this.personalWorkspaceId(user);
    const roots = await this.prisma.page.findMany({
      where: { isTemplate: true, isDeleted: false, parentId: null, workspaceId: { in: [...new Set([workspaceId, personalId])] }, kind: PageKind.DOC },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, icon: true, workspaceId: true, updatedAt: true },
    });
    const counts = await this.prisma.page.groupBy({
      by: ['parentId'],
      where: { parentId: { in: roots.map((r) => r.id) }, isDeleted: false },
      _count: { _all: true },
    });
    const subpages = new Map(counts.map((c) => [c.parentId, c._count._all]));
    const shape = (scope: Scope) => (r: (typeof roots)[number]) => ({ id: r.id, title: r.title || 'Untitled template', icon: r.icon, scope, subpageCount: subpages.get(r.id) ?? 0, updatedAt: r.updatedAt });
    return {
      // Where someone's own templates live: opening one goes there
      personalWorkspaceId: personalId,
      workspace: workspaceId === personalId ? [] : roots.filter((r) => r.workspaceId === workspaceId).map(shape('workspace')),
      personal: roots.filter((r) => r.workspaceId === personalId).map(shape('personal')),
      builtIn: BUILTIN_TEMPLATES.map(({ id, title, icon, description }) => ({ id, title, icon, description, scope: 'builtIn', subpageCount: 0 })),
    };
  }

  /**
   * A new template: blank, made from a page (and its subpages), or a copy of another template
   * (a built-in one, say). `scope` is the workspace's templates or the person's own.
   */
  async create(body: { workspaceId?: string; scope?: string; title?: string; fromPageId?: string; fromTemplateId?: string }, user: User) {
    const scope: Scope = body.scope === 'personal' ? 'personal' : 'workspace';
    const target = scope === 'personal' ? await this.personalWorkspaceId(user) : body.workspaceId;
    if (!target) throw new BadRequestException('workspaceId is required');
    const cleanup = emptyCleanup();
    let tree: Tree;
    if (body.fromPageId) {
      tree = await this.readPageTree(body.fromPageId, user, false, cleanup);
    } else if (body.fromTemplateId) {
      tree = await this.readTemplate(body.fromTemplateId, user, cleanup);
    } else {
      tree = { title: '', icon: null, content: [{ type: 'paragraph' }], children: [] };
    }
    if (typeof body.title === 'string' && body.title.trim()) tree.title = body.title.trim();
    const root = await this.writeTree(tree, { workspaceId: target, parentId: null, isTemplate: true }, user);
    return { id: root.id, workspaceId: target, scope, notes: describeCleanup(cleanup) };
  }

  /**
   * A page (and its subpages) made from a template, in a workspace: under a page if given, or at
   * the top as a private or public page. Or `pageId`: a new page that hasn't chosen its type yet,
   * made from the template where it is.
   */
  async use(templateId: string, body: { workspaceId?: string; parentId?: string | null; visibility?: string; pageId?: string }, user: User) {
    const tree = await this.readTemplate(templateId, user, emptyCleanup());
    if (body.pageId) {
      const { userId, userName } = this.requireUser(user);
      const page = await this.pages.fillNewPage(body.pageId, { title: tree.title, icon: tree.icon, content: { type: 'doc', content: tree.content } }, { userId, userName });
      for (const child of tree.children) {
        await this.writeTree(child, { workspaceId: page.workspaceId, parentId: page.id, isTemplate: false }, user);
      }
      return { id: page.id, workspaceId: page.workspaceId };
    }
    if (!body.workspaceId) throw new BadRequestException('workspaceId is required');
    const visibility = body.visibility === PageVisibility.PRIVATE ? PageVisibility.PRIVATE : undefined;
    const root = await this.writeTree(tree, { workspaceId: body.workspaceId, parentId: body.parentId ?? null, isTemplate: false, visibility }, user);
    return { id: root.id, workspaceId: root.workspaceId };
  }

  /** A template's content and subpages, made fit for any workspace (which it should be already). */
  private async readTemplate(templateId: string, user: User, cleanup: TemplateCleanup): Promise<Tree> {
    if (templateId.startsWith(BUILTIN_PREFIX)) {
      const builtin = findBuiltinTemplate(templateId);
      if (!builtin) throw new NotFoundException('Template not found');
      return { title: builtin.title, icon: builtin.icon, content: markdownToContent(builtin.markdown) as ContentNode[], children: [] };
    }
    return this.readPageTree(templateId, user, true, cleanup);
  }

  // A page and its document subpages as they are now; databases among them are left out (a
  // template holds documents)
  private async readPageTree(pageId: string, user: User, mustBeTemplate: boolean, cleanup: TemplateCleanup): Promise<Tree> {
    const { page } = await this.access.ensurePageReadAccess(pageId, user);
    const record = await this.prisma.page.findUniqueOrThrow({ where: { id: pageId }, select: { title: true, icon: true, isTemplate: true, kind: true } });
    if (mustBeTemplate && !record.isTemplate) throw new NotFoundException('Template not found');
    if (record.kind !== PageKind.DOC || page.kind !== PageKind.DOC) throw new BadRequestException('Only document pages can be templates');
    const content = templateContent(await this.pageContent.readContent(pageId, user), cleanup).content;
    const children = await this.prisma.page.findMany({
      where: { parentId: pageId, isDeleted: false, kind: PageKind.DOC },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const subtrees: Tree[] = [];
    for (const child of children) {
      try {
        subtrees.push(await this.readPageTree(child.id, user, false, cleanup));
      } catch (err) {
        // A private subpage of someone else's: not theirs to copy
        if (!(err instanceof ForbiddenException)) throw err;
      }
    }
    return { title: record.title, icon: record.icon, content, children: subtrees };
  }

  private async writeTree(tree: Tree, where: { workspaceId: string; parentId: string | null; isTemplate: boolean; visibility?: PageVisibility }, user: User): Promise<{ id: string; workspaceId: string }> {
    const { userId, userName } = this.requireUser(user);
    const page = await this.pages.createPage({
      workspaceId: where.workspaceId,
      parentId: where.parentId ?? undefined,
      title: tree.title,
      icon: tree.icon,
      content: { type: 'doc', content: tree.content },
      isTemplate: where.isTemplate,
      visibility: where.visibility,
      userId,
      userName,
    });
    for (const child of tree.children) {
      await this.writeTree(child, { workspaceId: page.workspaceId, parentId: page.id, isTemplate: where.isTemplate }, user);
    }
    return { id: page.id, workspaceId: page.workspaceId };
  }
}
