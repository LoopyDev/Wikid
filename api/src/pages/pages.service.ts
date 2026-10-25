import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma, BlockType, WorkspaceRole, DatabaseFieldType, PageKind, PageVisibility, PageSetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEditorContent } from './editor-doc.util';
import { deleteDatabasesWithContents } from '../utils/delete-databases.util';
import { isUuid } from '../utils/uuid.util';
import { PageAccessService } from './page-access.service';
import { DatabaseSetupService } from './database-setup.service';
import { CollabSyncService } from './collab-sync.service';
import { WikiService } from './wiki.service';
import { POSITION_INCREMENT, isSystemAdmin, canEdit, normalizePageTitle } from './pages.shared';

// Pages: listing, reading, editing, edit locks, visibility, moving, reordering, setup,
// bin and permanent delete, and the legacy blocks API.
@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly databaseSetup: DatabaseSetupService,
    private readonly collabSync: CollabSyncService,
    private readonly wiki: WikiService,
  ) {}

  private locks = new Map<string, { userId: string; userName: string; expires: number }>();
  private readonly LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes

  private readonly MIN_GAP = new Prisma.Decimal('0.0001');

  clearLocks() {
    this.locks.clear();
  }

  private cleanupLocks() {
    const now = Date.now();
    for (const [pageId, lock] of this.locks.entries()) {
      if (lock.expires <= now) {
        this.locks.delete(pageId);
      }
    }
  }

  private claimLock(pageId: string, userId?: string, userName?: string) {
    this.cleanupLocks();
    const now = Date.now();
    const safeUserId = userId || 'unknown';
    const safeUserName = userName || 'Someone';
    const existing = this.locks.get(pageId);
    if (existing && existing.expires > now) {
      // If the same display name is trying to claim, allow takeover to avoid stale-lock UX in dev/demo.
      if (existing.userId !== safeUserId && existing.userName !== safeUserName) {
        return existing;
      }
    }
    const next = { userId: safeUserId, userName: safeUserName, expires: now + this.LOCK_TTL_MS };
    this.locks.set(pageId, next);
    return next;
  }

  private async nextPosition(workspaceId: string, parentId: string | null) {
    const last = await this.prisma.page.findFirst({
      where: { workspaceId, parentId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    if (!last?.position) return POSITION_INCREMENT;
    return last.position.plus(POSITION_INCREMENT);
  }

  async listPages(params: { workspaceId?: string; userId?: string; userName?: string; includeDeleted?: boolean; state?: string }) {
    const { workspaceId, userId, userName, includeDeleted, state } = params;
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    const targetKey = workspaceId || `personal-${userId}`;
    const workspace = await this.access.resolveWorkspaceByKeyOrId(targetKey, userId, userName);
    const membership = await this.access.requireMembership(userId, workspace.id);
    const isAdmin = isSystemAdmin(userId);

    const onlyBin = state === 'bin';
    const visibilityFilter = isAdmin
      ? {}
      : membership.role === WorkspaceRole.VIEWER
        ? { visibility: PageVisibility.PUBLIC }
        : {
            OR: [
              { visibility: PageVisibility.PUBLIC },
              { visibility: PageVisibility.PRIVATE, authorId: userId },
            ],
          };
    const pages = await this.prisma.page.findMany({
      where: {
        workspaceId: workspace.id,
        ...(includeDeleted || onlyBin ? {} : { isDeleted: false }),
        ...(onlyBin ? { isDeleted: true } : {}),
        ...visibilityFilter,
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    const databasePageIds = pages.filter((page) => page.kind === PageKind.DATABASE).map((page) => page.id);
    if (!databasePageIds.length) return pages;
    const databases = await this.prisma.database.findMany({
      where: { pageId: { in: databasePageIds } },
      select: { pageId: true, complianceMode: true },
    });
    const complianceByPageId = new Map(databases.map((entry) => [entry.pageId, entry.complianceMode]));
    return pages.map((page) =>
      page.kind === PageKind.DATABASE
        ? { ...page, databaseComplianceMode: complianceByPageId.get(page.id) ?? false }
        : page
    );
  }

  async getPage(id: string, user?: { userId?: string; userName?: string }) {
    await this.access.requirePageAccess(id, user);
    const page = await this.prisma.page.findUniqueOrThrow({ where: { id } });
    const lock = this.claimLock(id, user?.userId, user?.userName);
    return {
      ...page,
      content: normalizeEditorContent(page.content),
      lockedBy: lock.userId,
      lockedByName: lock.userName,
    };
  }

  async updatePageContent(id: string, content: Prisma.InputJsonValue, user?: { userId?: string; userName?: string }) {
    await this.access.requirePageAccess(id, user, { requireWrite: true });
    const lock = this.claimLock(id, user?.userId, user?.userName);
    const now = Date.now();
    if (lock.userId !== (user?.userId || 'unknown') && lock.expires > now) {
      throw new ConflictException(`Page is currently being edited by ${lock.userName}`);
    }
    // refresh lock to extend editing session
    this.claimLock(id, user?.userId, user?.userName);
    const normalized = normalizeEditorContent(content);
    return this.prisma.page.update({
      where: { id },
      data: { content: normalized },
    });
  }

  // Deletes pages for good, with their blocks, databases and live-editing documents.
  // Pass whole subtrees: a page whose children survive can't be deleted. Callers check permissions.
  async removePages(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return { count: 0 };
    const pages = await tx.page.findMany({ where: { id: { in: ids } }, select: { id: true, workspaceId: true } });
    const docNames = pages.flatMap((page) => [`ws:${page.workspaceId}:${page.id}`, `ws:${page.workspaceId}:db:${page.id}`]);
    if (docNames.length) {
      await tx.collabDoc.deleteMany({ where: { documentName: { in: docNames } } });
    }
    const databases = await tx.database.findMany({ where: { pageId: { in: ids } }, select: { id: true } });
    await deleteDatabasesWithContents(tx, databases.map((db) => db.id));
    // Rows elsewhere (row pages, wiki rows) that open one of these pages lose the link.
    await tx.databaseRow.updateMany({ where: { pageId: { in: ids } }, data: { pageId: null } });
    await tx.block.deleteMany({ where: { pageId: { in: ids } } });
    return tx.page.deleteMany({ where: { id: { in: ids } } });
  }

  async updatePage(id: string, data: { title?: string; icon?: string }, user?: { userId?: string; userName?: string }) {
    await this.access.requirePageAccess(id, user, { requireWrite: true });
    const updateData: Prisma.PageUpdateInput = {};
    if (typeof data.title === 'string') {
      updateData.title = data.title;
    }
    if (typeof data.icon === 'string') {
      updateData.icon = data.icon;
    }
    const updated = await this.prisma.page.update({
      where: { id },
      data: updateData,
    });
    if (typeof data.title === 'string') {
      const row = await this.prisma.databaseRow.findFirst({
        where: { pageId: id },
        select: { id: true, databaseId: true, data: true },
      });
      if (row) {
        const titleFieldId = await this.databaseSetup.resolveDatabaseTitleFieldId(row.databaseId);
        if (titleFieldId) {
          const rowData = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...(row.data as any) } : {};
          rowData[titleFieldId] = normalizePageTitle(data.title);
          await this.prisma.databaseRow.update({
            where: { id: row.id },
            data: { data: rowData },
          });
        }
      }
      await this.collabSync.updateCollabTitleForPage(
        { id: updated.id, workspaceId: updated.workspaceId, kind: updated.kind },
        updated.title
      );
    }
    return updated;
  }

  async updatePageVisibility(id: string, visibility: PageVisibility, user?: { userId?: string; userName?: string }) {
    const target =
      visibility && Object.values(PageVisibility).includes(visibility) ? (visibility as PageVisibility) : null;
    if (!target) {
      throw new BadRequestException('visibility is required');
    }
    const { page } = await this.access.requirePageAccess(id, user, { requireWrite: true });
    const descendantIds = await this.access.collectDescendantIds(id);
    const idsToUpdate = [id, ...descendantIds];
    const forbiddenPrivate = await this.prisma.page.findFirst({
      where: {
        id: { in: idsToUpdate },
        visibility: PageVisibility.PRIVATE,
        NOT: { authorId: user?.userId || '' },
      },
      select: { id: true },
    });
    if (forbiddenPrivate) {
      throw new ForbiddenException('Cannot move private pages you do not own');
    }
    const updateData: Prisma.PageUncheckedUpdateManyInput = { visibility: target };
    if (target === PageVisibility.PRIVATE) {
      if (!user?.userId) {
        throw new BadRequestException('userId is required');
      }
      updateData.authorId = user.userId;
    }
    await this.prisma.page.updateMany({
      where: { id: { in: idsToUpdate } },
      data: updateData,
    });
    let updatedPage = await this.prisma.page.findUnique({
      where: { id },
      select: { id: true, parentId: true, position: true, visibility: true, authorId: true },
    });
    if (page.parentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: page.parentId },
        select: { id: true, visibility: true, isDeleted: true },
      });
      if (parent && !parent.isDeleted && parent.visibility !== target) {
        const position = await this.nextPosition(page.workspaceId, null);
        updatedPage = await this.prisma.page.update({
          where: { id },
          data: { parentId: null, position },
          select: { id: true, parentId: true, position: true, visibility: true, authorId: true },
        });
      }
    }
    return { page: updatedPage, updatedIds: idsToUpdate };
  }

  async movePageToWorkspace(
    pageId: string,
    targetWorkspaceId: string,
    user?: { userId?: string; userName?: string },
  ) {
    if (!isUuid(targetWorkspaceId)) throw new BadRequestException('Invalid targetWorkspaceId');
    const { page } = await this.access.requirePageAccess(pageId, user, { requireWrite: true });
    if (page.workspaceId === targetWorkspaceId) {
      throw new BadRequestException('Page is already in that workspace');
    }
    const userId = user?.userId!;
    const targetMembership = await this.access.requireMembership(userId, targetWorkspaceId);
    if (!canEdit(targetMembership.role)) {
      throw new ForbiddenException('Editor access required in the target workspace');
    }
    const descendantIds = await this.access.collectDescendantIds(pageId);
    const idsToMove = [pageId, ...descendantIds];
    const newPosition = await this.nextPosition(targetWorkspaceId, null);
    await this.prisma.page.updateMany({
      where: { id: { in: idsToMove } },
      data: { workspaceId: targetWorkspaceId },
    });
    const updatedPage = await this.prisma.page.update({
      where: { id: pageId },
      data: { parentId: null, position: newPosition },
      select: {
        id: true, workspaceId: true, parentId: true, position: true,
        title: true, visibility: true, kind: true, icon: true, isDeleted: true, isHidden: true,
        setupStatus: true, wikiHomeId: true, wikiConfig: true,
      },
    });
    return { page: updatedPage, movedIds: idsToMove };
  }

  async listBlocksForPage(pageId: string, user?: { userId?: string; userName?: string }) {
    await this.access.requirePageAccess(pageId, user);
    return this.prisma.block.findMany({
      where: { pageId },
      orderBy: { position: 'asc' },
    });
  }

  async createBlock(
    pageId: string,
    payload: { type?: BlockType; content?: string; props?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    await this.access.requirePageAccess(pageId, user, { requireWrite: true });
    // place new block at the end if no position provided
    let position = payload.position;
    if (!position) {
      const last = await this.prisma.block.findFirst({
        where: { pageId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      position = last?.position ? last.position.plus(new Prisma.Decimal(1)) : new Prisma.Decimal(1);
    }

    return this.prisma.block.create({
      data: {
        pageId,
        type: payload.type ?? BlockType.TEXT,
        content: payload.content ?? '',
        props: payload.props ?? {},
        position,
      },
    });
  }

  async updateBlock(id: string, data: Partial<Prisma.BlockUpdateInput>, user?: { userId?: string; userName?: string }) {
    const block = await this.prisma.block.findUnique({ where: { id }, select: { pageId: true } });
    if (!block) throw new NotFoundException('Block not found');
    await this.access.requirePageAccess(block.pageId, user, { requireWrite: true });
    return this.prisma.block.update({
      where: { id },
      data,
    });
  }

  async createPage(body: {
    workspaceId?: string;
    title?: string;
    userId?: string;
    userName?: string;
    parentId?: string;
    kind?: PageKind;
    visibility?: PageVisibility;
    setupStatus?: PageSetupStatus;
    complianceMode?: boolean;
    database?: {
      fields?: Array<{ name?: string; type?: DatabaseFieldType; options?: Prisma.JsonValue; position?: number | string }>;
      workflow?: Prisma.InputJsonValue;
      template?: string;
    };
  }) {
    if (!body.workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }
    if (!body.userId) {
      throw new BadRequestException('userId is required');
    }
    const workspace = await this.access.resolveWorkspaceByKeyOrId(body.workspaceId, body.userId, body.userName);
    const membership = await this.access.requireMembership(body.userId, workspace.id);
    if (!canEdit(membership.role)) {
      throw new ForbiddenException('Forbidden: editor access required');
    }
    const parentId = body.parentId ?? null;
    const position = await this.nextPosition(workspace.id, parentId);
    const kind: PageKind = body.kind && Object.values(PageKind).includes(body.kind) ? body.kind : PageKind.DOC;
    let visibility: PageVisibility = body.visibility && Object.values(PageVisibility).includes(body.visibility) ? body.visibility : PageVisibility.PUBLIC;
    const setupStatus: PageSetupStatus =
      body.setupStatus && Object.values(PageSetupStatus).includes(body.setupStatus) ? body.setupStatus : PageSetupStatus.COMPLETE;
    let wikiHomeId: string | null = null;
    if (parentId) {
      const parent = await this.access.requirePageAccess(parentId, { userId: body.userId, userName: body.userName }, { requireWrite: true });
      if (parent.page.workspaceId !== workspace.id) {
        throw new BadRequestException('parent does not exist in workspace');
      }
      visibility = parent.page.visibility;
      wikiHomeId = parent.page.wikiHomeId ?? null;
    }
    if (visibility === PageVisibility.PRIVATE && !body.userId) {
      throw new BadRequestException('Private pages require an author');
    }
    const page = await this.prisma.page.create({
      data: {
        workspaceId: workspace.id,
        title: body.title || '',
        content: normalizeEditorContent(null),
        parentId,
        position,
        kind,
        visibility,
        setupStatus,
        authorId: body.userId,
        wikiHomeId,
      },
    });
    const complianceMode = typeof body.complianceMode === 'boolean' ? body.complianceMode : undefined;
    if (kind === PageKind.DATABASE && setupStatus === PageSetupStatus.COMPLETE) {
      const setupConfig = this.databaseSetup.resolveDatabaseSetupConfig(body.database);
      await this.databaseSetup.createDatabaseForPage(
        page.id,
        workspace.id,
        { complianceMode, fields: setupConfig.fields, workflowConfig: setupConfig.workflowConfig },
        { userId: body.userId, userName: body.userName }
      );
    }
    if (page.wikiHomeId) {
      await this.wiki.ensureWikiRowForPage(page);
    }
    if (page.kind === PageKind.DATABASE) {
      return { ...page, databaseComplianceMode: typeof complianceMode === 'boolean' ? complianceMode : false };
    }
    return page;
  }

  async updatePageSetup(
    id: string,
    payload: {
      kind?: PageKind;
      setupStatus?: PageSetupStatus;
      complianceMode?: boolean;
      database?: {
        fields?: Array<{ name?: string; type?: DatabaseFieldType; options?: Prisma.JsonValue; position?: number | string }>;
        workflow?: Prisma.InputJsonValue;
        template?: string;
      };
    },
    user?: { userId?: string; userName?: string }
  ) {
    const { page } = await this.access.requirePageAccess(id, user, { requireWrite: true });
    const nextKind = payload.kind && Object.values(PageKind).includes(payload.kind) ? payload.kind : undefined;
    const nextStatus =
      payload.setupStatus && Object.values(PageSetupStatus).includes(payload.setupStatus) ? payload.setupStatus : undefined;
    const nextComplianceMode = typeof payload.complianceMode === 'boolean' ? payload.complianceMode : undefined;
    const setupConfig = this.databaseSetup.resolveDatabaseSetupConfig(payload.database);

    if (!nextKind && !nextStatus && nextComplianceMode === undefined) {
      throw new BadRequestException('kind, setupStatus, or complianceMode is required');
    }

    if (page.setupStatus === PageSetupStatus.COMPLETE) {
      if ((nextStatus && nextStatus !== PageSetupStatus.COMPLETE) || (nextKind && nextKind !== page.kind)) {
        throw new ConflictException('Setup already completed');
      }
    }

    const updateData: Prisma.PageUpdateInput = {};
    if (nextStatus) {
      updateData.setupStatus = nextStatus;
    }
    if (nextKind) {
      updateData.kind = nextKind;
    }

    if (nextKind && nextKind !== page.kind) {
      if (page.setupStatus !== PageSetupStatus.PENDING) {
        throw new ConflictException('Page type can only be changed while setup is pending');
      }
      if (nextKind === PageKind.DATABASE) {
        const existing = await this.prisma.database.findUnique({ where: { pageId: page.id }, select: { id: true } });
        if (!existing) {
          await this.databaseSetup.createDatabaseForPage(page.id, page.workspaceId, {
            complianceMode: nextComplianceMode ?? false,
            fields: setupConfig.fields,
            workflowConfig: setupConfig.workflowConfig,
          }, user);
        } else if (nextComplianceMode !== undefined) {
          await this.prisma.database.update({
            where: { id: existing.id },
            data: { complianceMode: nextComplianceMode },
          });
        }
      } else if (page.kind === PageKind.DATABASE && nextKind === PageKind.DOC) {
        const database = await this.prisma.database.findUnique({ where: { pageId: page.id }, select: { id: true } });
        if (database) {
          await this.prisma.$transaction((tx) => deleteDatabasesWithContents(tx, [database.id]));
        }
      }
    }

    const completing = nextStatus === PageSetupStatus.COMPLETE && page.setupStatus !== PageSetupStatus.COMPLETE;
    const finalKind = nextKind || page.kind;
    if (completing && finalKind === PageKind.DATABASE) {
      const existing = await this.prisma.database.findUnique({ where: { pageId: page.id }, select: { id: true } });
      if (!existing) {
        await this.databaseSetup.createDatabaseForPage(page.id, page.workspaceId, {
          complianceMode: nextComplianceMode ?? false,
          fields: setupConfig.fields,
          workflowConfig: setupConfig.workflowConfig,
        }, user);
      } else if (nextComplianceMode !== undefined) {
        await this.prisma.database.update({
          where: { id: existing.id },
          data: { complianceMode: nextComplianceMode },
        });
      }
    }

    if (nextComplianceMode !== undefined && finalKind === PageKind.DATABASE && !completing && !nextKind) {
      const existing = await this.prisma.database.findUnique({ where: { pageId: page.id }, select: { id: true } });
      if (existing) {
        await this.prisma.database.update({
          where: { id: existing.id },
          data: { complianceMode: nextComplianceMode },
        });
      }
    }

    const updated = await this.prisma.page.update({
      where: { id },
      data: updateData,
    });
    if (updated.kind === PageKind.DATABASE) {
      const database = await this.prisma.database.findUnique({
        where: { pageId: updated.id },
        select: { complianceMode: true },
      });
      return { ...updated, databaseComplianceMode: database?.complianceMode ?? false };
    }
    return updated;
  }

  async deletePage(id: string, user?: { userId?: string; userName?: string }) {
    await this.access.requirePageAccess(id, user, { requireWrite: true });
    const descendantIds = await this.access.collectDescendantIds(id);
    const idsToDelete = [id, ...descendantIds];
    const forbiddenPrivate = await this.prisma.page.findFirst({
      where: {
        id: { in: idsToDelete },
        visibility: PageVisibility.PRIVATE,
        NOT: { authorId: user?.userId || '' },
      },
      select: { id: true },
    });
    if (forbiddenPrivate) {
      throw new ForbiddenException('Cannot delete private pages you do not own');
    }
    const deletedAt = new Date();
    await this.prisma.block.deleteMany({ where: { pageId: { in: idsToDelete } } });
    return this.prisma.page.updateMany({
      where: { id: { in: idsToDelete } },
      data: { isDeleted: true, deletedAt },
    });
  }

  async destroyPages(ids: string[], user?: { userId?: string; userName?: string }) {
    if (!ids?.length) return { count: 0 };
    await Promise.all(ids.map((pageId) => this.access.requirePageAccess(pageId, user, { requireWrite: true, allowDeleted: true })));
    return this.prisma.$transaction((tx) => this.removePages(tx, ids));
  }

  async restorePage(id: string, user?: { userId?: string; userName?: string }) {
    await this.access.requirePageAccess(id, user, { requireWrite: true, allowDeleted: true });
    const descendantIds = await this.access.collectDescendantIds(id);
    const idsToRestore = [id, ...descendantIds];
    return this.prisma.page.updateMany({
      where: { id: { in: idsToRestore } },
      data: { isDeleted: false, deletedAt: null },
    });
  }

  async reorderSiblings(payload: { parentId: string | null; orderedIds: string[] }, user?: { userId?: string; userName?: string }) {
    const rawParentId = payload.parentId ?? null;
    const parentId = isUuid(rawParentId || undefined) ? rawParentId : null;
    const { orderedIds } = payload;
    if (!Array.isArray(orderedIds) || !orderedIds.length) {
      throw new BadRequestException('orderedIds required');
    }

    await this.access.requirePageAccess(orderedIds[0], user, { requireWrite: true });
    const anchor = await this.prisma.page.findUnique({
      where: { id: orderedIds[0] },
      select: { workspaceId: true, isDeleted: true },
    });
    if (!anchor) {
      throw new BadRequestException('first orderedId not found');
    }
    if (anchor.isDeleted) {
      throw new BadRequestException('cannot reorder deleted pages');
    }

    const workspaceId = anchor.workspaceId;
    if (parentId) {
      const parent = await this.prisma.page.findUnique({ where: { id: parentId }, select: { workspaceId: true, isDeleted: true } });
      if (!parent || parent.isDeleted || parent.workspaceId !== workspaceId) {
        throw new BadRequestException('parent does not exist in workspace');
      }
    }

    const siblings = await this.prisma.page.findMany({
      where: { parentId: parentId ?? null, workspaceId, isDeleted: false },
      orderBy: { position: 'asc' },
      select: { id: true, position: true, workspaceId: true },
    });
    const siblingIds = siblings.map((s) => s.id);
    const siblingIdSet = new Set(siblingIds);

    // Allow incoming pages from other parents, but ensure all target siblings are represented
    const uniqueOrdered = Array.from(new Set(orderedIds));
    if (uniqueOrdered.length !== orderedIds.length) {
      throw new BadRequestException('orderedIds must be unique');
    }

    const orderedPages = await this.prisma.page.findMany({
      where: { id: { in: uniqueOrdered }, workspaceId, isDeleted: false },
      select: { id: true, position: true, workspaceId: true, visibility: true, authorId: true, wikiHomeId: true },
    });
    if (orderedPages.length !== uniqueOrdered.length) {
      throw new BadRequestException('orderedIds must all exist and be active in the workspace');
    }
    const forbiddenPrivate = orderedPages.find(
      (page) => page.visibility === PageVisibility.PRIVATE && page.authorId !== user?.userId
    );
    if (forbiddenPrivate) {
      throw new ForbiddenException('Cannot reorder private pages you do not own');
    }

    // If the client omitted some existing siblings (stale state), keep them in their current order after the provided IDs.
    const missingSiblings = siblingIds.filter((id) => !uniqueOrdered.includes(id));
    const fullOrder = [...uniqueOrdered, ...missingSiblings];

    const currentPos = new Map(siblings.map((s) => [s.id, s.position]));
    const newPos = new Map<string, Prisma.Decimal>();
    let normalize = false;

    for (let i = 0; i < fullOrder.length; i += 1) {
      const id = fullOrder[i];
      const prevId = i > 0 ? fullOrder[i - 1] : null;
      const nextId = i < fullOrder.length - 1 ? fullOrder[i + 1] : null;
      const prev = prevId ? newPos.get(prevId) ?? currentPos.get(prevId) : null;
      const next = nextId ? currentPos.get(nextId) : null;

      if (prev && next) {
        const gap = next.minus(prev);
        if (gap.lte(this.MIN_GAP)) {
          normalize = true;
          break;
        }
        newPos.set(id, prev.plus(gap.dividedBy(2)));
      } else if (prev && !next) {
        newPos.set(id, prev.plus(POSITION_INCREMENT));
      } else if (!prev && next) {
        newPos.set(id, next.minus(POSITION_INCREMENT));
      } else {
        newPos.set(id, POSITION_INCREMENT);
      }
    }

    if (normalize) {
      fullOrder.forEach((id, index) => {
        newPos.set(id, new Prisma.Decimal(index + 1));
      });
    }

    const updates = fullOrder.map((id) =>
      this.prisma.page.update({
        where: { id },
        data: {
          parentId: parentId ?? null,
          position: newPos.get(id) ?? POSITION_INCREMENT,
        },
      })
    );
    await this.prisma.$transaction(updates);
    const targetWikiHomeId = parentId
      ? (await this.prisma.page.findUnique({ where: { id: parentId }, select: { wikiHomeId: true } }))?.wikiHomeId ?? null
      : null;
    if (orderedPages.length) {
      for (const page of orderedPages) {
        if (!page) continue;
        if (page.wikiHomeId === page.id) {
          continue;
        }
        if (page.wikiHomeId === targetWikiHomeId) {
          continue;
        }
        const descendantIds = await this.access.collectDescendantIds(page.id);
        await this.prisma.page.updateMany({
          where: {
            id: { in: [page.id, ...descendantIds] },
            wikiHomeId: page.wikiHomeId ?? null,
          },
          data: { wikiHomeId: targetWikiHomeId },
        });
      }
    }
    if (targetWikiHomeId) {
      await this.wiki.ensureWikiRowsForHome(targetWikiHomeId);
    }
    return { count: orderedIds.length, normalized: normalize };
  }
}
