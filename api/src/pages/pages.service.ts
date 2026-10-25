import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Prisma, BlockType, WorkspaceRole, DatabaseFieldType, PageKind, PageVisibility, PageSetupStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEditorContent } from './editor-doc.util';
import { isUuid } from '../utils/uuid.util';
import { TRUE_STRINGS, FALSE_STRINGS } from '../utils/boolean-strings.const';
import { INVENTORY_TEMPLATE_FIELDS, MAINTENANCE_TEMPLATE_FIELDS, ASSIGNMENTS_TEMPLATE_FIELDS } from '../constants/database-templates.const';
import { SYSTEM_ADMIN_ID } from '../constants/system-admin.const';
import { assertSystemAdmin } from '../utils/assert-admin.util';
import { updateCollabTitleState } from '../collab/collab-doc.util';
import { deleteCollabDatabaseRowState, updateCollabDatabaseRowState } from '../collab/collab-database.util';
import { ComplianceService } from '../compliance/compliance.service';
import jwt from 'jsonwebtoken';

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  try {
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return timingSafeEqual(Buffer.from(key, 'hex'), derivedKey);
  } catch {
    return false;
  }
}

@Injectable()
export class PagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService
  ) {}

  private readonly collabJwtSecret = process.env.COLLAB_JWT_SECRET;
  private readonly collabServerUrl = process.env.COLLAB_SERVER_URL;
  private readonly collabApiSecret = process.env.COLLAB_API_SECRET;
  private readonly RESET_WORKSPACES_CONFIRM_TEXT = 'RESET ALL WORKSPACES';
  private locks = new Map<string, { userId: string; userName: string; expires: number }>();
  private readonly LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes
  private readonly POSITION_INCREMENT = new Prisma.Decimal(1);
  private readonly MIN_GAP = new Prisma.Decimal('0.0001');
  private readonly DEFAULT_DB_FIELD_NAME = 'Name';
  private readonly DEFAULT_FORM_ICON = 'icon:pencil-square';
  private readonly COMPLIANCE_RECORD_KEY = '__complianceRecordId';
  private readonly GOVERNANCE_FILTER_FIELD_ID = '__governanceStatus__';
  private readonly RELATION_HISTORY_FIELDS = {
    title: 'Change Summary',
    source: 'Source Record',
    target: 'Target Record',
    action: 'Action',
    changedAt: 'Changed At',
    changedBy: 'Changed By',
  };
  private readonly RELATION_HISTORY_ACTIONS = {
    added: 'Added',
    removed: 'Removed',
  };
  private readonly DEFAULT_COMPLIANCE_WORKFLOW = {
    states: [
      { id: 'draft', label: 'Draft' },
      { id: 'submitted', label: 'Submitted' },
      { id: 'review', label: 'In Review' },
      { id: 'closed', label: 'Closed/Sealed' },
    ],
    transitions: [
      { from: 'draft', to: 'submitted', guards: [] },
      { from: 'submitted', to: 'review', guards: [{ type: 'role', value: 'reviewer' }] },
      { from: 'review', to: 'closed', guards: [{ type: 'role', value: 'reviewer' }, { type: 'approval' }] },
      { from: 'closed', to: 'review', guards: [{ type: 'reason' }, { type: 'approval' }] },
    ],
  };

  private async applyCollabStateUpdate(
    documentName: string,
    updater: (state: Buffer) => Buffer | null,
    warnMessage: string,
    warnContext: Record<string, unknown> = {},
  ) {
    try {
      let record = await this.prisma.collabDoc.findUnique({
        where: { documentName },
        select: { state: true, updatedAt: true },
      });
      if (!record?.state) return;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const nextState = updater(record.state);
        if (!nextState) return;
        const res = await this.prisma.collabDoc.updateMany({
          where: { documentName, updatedAt: record.updatedAt },
          data: { state: nextState },
        });
        if (res.count) return;
        record = await this.prisma.collabDoc.findUnique({
          where: { documentName },
          select: { state: true, updatedAt: true },
        });
        if (!record?.state) return;
      }
    } catch (err) {
      console.warn(warnMessage, { documentName, ...warnContext, error: err });
    }
  }

  private async updateCollabTitleForPage(
    page: { id: string; workspaceId: string; kind: PageKind },
    title: string
  ) {
    if (!page?.id || !page.workspaceId) return;
    if (page.kind !== PageKind.DOC) return;
    const documentName = `ws:${page.workspaceId}:${page.id}`;
    await this.applyCollabStateUpdate(
      documentName,
      (state) => updateCollabTitleState(state, title),
      'Failed to sync collab title',
    );
  }

  private async updateCollabDatabaseRowForPage(
    database: { pageId: string; workspaceId: string },
    row: { id: string; data?: Prisma.InputJsonValue | null; pageId?: string | null }
  ) {
    if (!database?.pageId || !database.workspaceId || !row?.id) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    await this.applyCollabStateUpdate(
      documentName,
      (state) => updateCollabDatabaseRowState(state, {
        id: row.id,
        data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : {},
        pageId: row.pageId || null,
      }),
      'Failed to sync collab db row',
      { rowId: row.id },
    );
  }

  private async pushCollabDatabaseRowUpdate(
    database: { pageId: string; workspaceId: string },
    row: { id: string; data?: Prisma.InputJsonValue | null; pageId?: string | null }
  ) {
    if (!this.collabServerUrl || !this.collabApiSecret) return;
    if (!database?.pageId || !database.workspaceId || !row?.id) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    const payload = {
      documentName,
      rowId: row.id,
      data: row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {},
      pageId: row.pageId || null,
    };
    try {
      const res = await fetch(`${this.collabServerUrl}/collab/push/db-row`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.collabApiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn('Collab push failed', { documentName, rowId: row.id, status: res.status });
      }
    } catch (err) {
      console.warn('Collab push error', { documentName, rowId: row.id, error: err });
    }
  }

  private async pushCollabDatabaseRowDelete(database: { pageId: string; workspaceId: string }, rowId: string) {
    if (!this.collabServerUrl || !this.collabApiSecret) return;
    if (!database?.pageId || !database.workspaceId || !rowId) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    const payload = { documentName, rowId };
    try {
      const res = await fetch(`${this.collabServerUrl}/collab/push/db-row-delete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.collabApiSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn('Collab push delete failed', { documentName, rowId, status: res.status });
      }
    } catch (err) {
      console.warn('Collab push delete error', { documentName, rowId, error: err });
    }
  }

  private async deleteCollabDatabaseRowForPage(database: { pageId: string; workspaceId: string }, rowId: string) {
    if (!database?.pageId || !database.workspaceId || !rowId) return;
    const documentName = `ws:${database.workspaceId}:db:${database.pageId}`;
    await this.applyCollabStateUpdate(
      documentName,
      (state) => deleteCollabDatabaseRowState(state, rowId),
      'Failed to sync collab db row delete',
      { rowId },
    );
  }

  private sanitizeUserPreferences(payload: any) {
    const prefs: Record<string, any> = {};
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      if (typeof payload.sidebarHidden === 'boolean') prefs.sidebarHidden = payload.sidebarHidden;
    }
    return prefs;
  }

  private normalizeFormIcon(value: unknown) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private async ensureUser(userId?: string, userName?: string) {
    const id = isUuid(userId) ? (userId as string) : randomUUID();
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (existing) return existing;
    return this.prisma.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        displayName: userName || userId || id,
      },
    });
  }

  private async resolveWorkspaceByKeyOrId(workspaceKey: string, userId?: string, userName?: string) {
    const key = workspaceKey || 'global';
    if (isUuid(key)) {
      const existingById = await this.prisma.workspace.findUnique({ where: { id: key } });
      if (!existingById) {
        throw new Error('Workspace not found');
      }
      return existingById;
    }
    if (key === 'global') {
      return this.ensureGlobalWorkspace();
    }
    if (key.startsWith('personal-')) {
      const rawId = key.replace('personal-', '').trim();
      const targetUserId = userId || rawId;
      if (!targetUserId || (userId && rawId && rawId !== userId)) {
        throw new Error('Forbidden: personal workspace access denied');
      }
      const personal = await this.prisma.workspace.findFirst({ where: { personalOwnerId: targetUserId } });
      if (!personal) throw new Error('Workspace not found');
      return personal;
    }
    throw new Error('Workspace key not supported');
  }

  private async ensureGlobalWorkspace() {
    const existing = await this.prisma.workspace.findFirst({ where: { name: 'Global' } });
    if (existing) return existing;
    return this.prisma.workspace.create({ data: { name: 'Global' } });
  }

  private async ensurePersonalWorkspace(userId: string, userName?: string) {
    const existing = await this.prisma.workspace.findFirst({ where: { personalOwnerId: userId } });
    if (existing) return existing;

    const legacy = await this.prisma.userWorkspace.findFirst({
      where: {
        userId,
        role: WorkspaceRole.OWNER,
        workspace: {
          name: { endsWith: "'s Workspace" },
          personalOwnerId: null,
        },
      },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    if (legacy?.workspace) {
      return this.prisma.workspace.update({
        where: { id: legacy.workspace.id },
        data: { personalOwnerId: userId },
      });
    }

    const baseName = `${userName || userId}'s Workspace`;
    return this.prisma.workspace.create({ data: { name: baseName, personalOwnerId: userId } });
  }

  private async ensureMembership(userId: string, workspaceId: string, role: WorkspaceRole = WorkspaceRole.EDITOR) {
    const member = await this.prisma.userWorkspace.findFirst({ where: { userId, workspaceId } });
    if (member) return member;
    return this.prisma.userWorkspace.create({ data: { userId, workspaceId, role } });
  }

  private async ensureDefaultWorkspaces(userId: string, userName?: string) {
    await this.ensureUser(userId, userName);
    const personalWorkspace = await this.ensurePersonalWorkspace(userId, userName);
    await this.ensureMembership(userId, personalWorkspace.id, WorkspaceRole.OWNER);
    return { personalWorkspace };
  }

  private async getMembership(userId: string, workspaceId: string) {
    return this.prisma.userWorkspace.findFirst({ where: { userId, workspaceId } });
  }

  private isSystemAdmin(userId?: string) {
    if (!userId || userId !== SYSTEM_ADMIN_ID) return false;
    if (process.env.WIKID_ADMIN_BYPASS === 'true') return true;
    return process.env.NODE_ENV !== 'production';
  }

  private stripPassword<T extends { passwordHash?: string | null }>(user: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _pw, ...rest } = user;
    return rest;
  }

  private async requireMembership(userId: string, workspaceId: string) {
    if (this.isSystemAdmin(userId)) {
      return { userId, workspaceId, role: WorkspaceRole.OWNER };
    }
    const member = await this.getMembership(userId, workspaceId);
    if (!member) {
      throw new Error('Forbidden: workspace access required');
    }
    return member;
  }

  private async getWorkspaceMemberships(userId: string) {
    return this.prisma.userWorkspace.findMany({
      where: { userId },
      select: { workspaceId: true, role: true },
    });
  }

  private canEdit(role: WorkspaceRole) {
    return role === WorkspaceRole.OWNER || role === WorkspaceRole.EDITOR;
  }

  private async requireWorkspaceRole(userId: string, workspaceId: string, allowed: WorkspaceRole[]) {
    if (this.isSystemAdmin(userId)) {
      return { userId, workspaceId, role: WorkspaceRole.OWNER };
    }
    const membership = await this.requireMembership(userId, workspaceId);
    if (!allowed.includes(membership.role)) {
      throw new Error('Forbidden: insufficient workspace role');
    }
    return membership;
  }

  private async ensureNotLastOwner(workspaceId: string) {
    const ownerCount = await this.prisma.userWorkspace.count({
      where: { workspaceId, role: WorkspaceRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new Error('Workspace must have at least one owner');
    }
  }

  private async requirePageAccess(
    pageId: string,
    user?: { userId?: string; userName?: string },
    options: { requireWrite?: boolean; allowDeleted?: boolean } = {}
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new Error('userId is required');
    }
    const isAdmin = this.isSystemAdmin(userId);
    const page = await this.prisma.page.findUniqueOrThrow({
      where: { id: pageId },
      select: {
        id: true,
        workspaceId: true,
        parentId: true,
        visibility: true,
        authorId: true,
        isDeleted: true,
        kind: true,
        setupStatus: true,
        wikiHomeId: true,
        isHidden: true,
      },
    });
    if (page.isDeleted && !options.allowDeleted) {
      throw new Error('Page is in the bin');
    }
    const membership = await this.requireMembership(userId, page.workspaceId);
    if (page.visibility === PageVisibility.PRIVATE && !isAdmin) {
      if (membership.role === WorkspaceRole.VIEWER) {
        throw new Error('Forbidden: private page access denied');
      }
      if (!page.authorId || page.authorId !== userId) {
        throw new Error('Forbidden: private page access denied');
      }
    }
    if (options.requireWrite && !this.canEdit(membership.role)) {
      throw new Error('Forbidden: editor access required');
    }
    return { page, membership };
  }

  async ensurePageReadAccess(pageId: string, user?: { userId?: string; userName?: string }) {
    return this.requirePageAccess(pageId, user);
  }

  async ensurePageWriteAccess(pageId: string, user?: { userId?: string; userName?: string }) {
    return this.requirePageAccess(pageId, user, { requireWrite: true });
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

  // Admin-only actions check identity only. isSystemAdmin() also covers the dev-only
  // permission bypass, so it's false in production and locked the admin out of these.
  private ensureAdmin(adminId?: string) {
    assertSystemAdmin(adminId);
  }

  private async nextPosition(workspaceId: string, parentId: string | null) {
    const last = await this.prisma.page.findFirst({
      where: { workspaceId, parentId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    if (!last?.position) return this.POSITION_INCREMENT;
    return last.position.plus(this.POSITION_INCREMENT);
  }

  async listPages(params: { workspaceId?: string; userId?: string; userName?: string; includeDeleted?: boolean; state?: string }) {
    const { workspaceId, userId, userName, includeDeleted, state } = params;
    if (!userId) {
      throw new Error('userId is required');
    }
    const targetKey = workspaceId || `personal-${userId}`;
    const workspace = await this.resolveWorkspaceByKeyOrId(targetKey, userId, userName);
    const membership = await this.requireMembership(userId, workspace.id);
    const isAdmin = this.isSystemAdmin(userId);

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
    await this.requirePageAccess(id, user);
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
    await this.requirePageAccess(id, user, { requireWrite: true });
    const lock = this.claimLock(id, user?.userId, user?.userName);
    const now = Date.now();
    if (lock.userId !== (user?.userId || 'unknown') && lock.expires > now) {
      throw new Error(`Page is currently being edited by ${lock.userName}`);
    }
    // refresh lock to extend editing session
    this.claimLock(id, user?.userId, user?.userName);
    const normalized = normalizeEditorContent(content);
    return this.prisma.page.update({
      where: { id },
      data: { content: normalized },
    });
  }

  async listSharedWorkspaces(adminId?: string) {
    this.ensureAdmin(adminId);
    return this.prisma.workspace.findMany({
      where: { personalOwnerId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listWorkspaces(userId?: string, userName?: string, adminId?: string) {
    const workspaceSelect = {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { pages: { where: { isDeleted: false, isHidden: false } } } },
    };
    if (adminId && this.isSystemAdmin(adminId)) {
      const workspaces = await this.prisma.workspace.findMany({
        select: workspaceSelect,
        orderBy: { createdAt: 'asc' },
      });
      return workspaces.map((workspace) => ({
        userId: adminId,
        workspaceId: workspace.id,
        role: WorkspaceRole.OWNER,
        workspace,
      }));
    }
    if (userId) {
      if (this.isSystemAdmin(userId)) {
        const workspaces = await this.prisma.workspace.findMany({
          select: workspaceSelect,
          orderBy: { createdAt: 'asc' },
        });
        return workspaces.map((workspace) => ({
          userId,
          workspaceId: workspace.id,
          role: WorkspaceRole.OWNER,
          workspace,
        }));
      }
      return this.prisma.userWorkspace.findMany({
        where: { userId },
        include: { workspace: { select: workspaceSelect } },
        orderBy: { createdAt: 'asc' },
      });
    }
    return this.listSharedWorkspaces(adminId);
  }

  async createWorkspace(payload: { name?: string; userId?: string; userName?: string }) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      throw new Error('name is required');
    }
    if (!payload.userId) {
      throw new Error('userId is required');
    }
    const user = await this.ensureUser(payload.userId, payload.userName);
    const existing = await this.prisma.workspace.findFirst({ where: { name } });
    if (existing) {
      throw new Error('Workspace name already exists');
    }
    const workspace = await this.prisma.workspace.create({ data: { name } });
    await this.ensureMembership(user.id, workspace.id, WorkspaceRole.OWNER);
    return { workspace, role: WorkspaceRole.OWNER };
  }

  async updateWorkspace(workspaceId: string, data: { name?: string }, userId: string) {
    if (!workspaceId || !userId) throw new BadRequestException('workspaceId and userId are required');
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!this.isSystemAdmin(userId)) {
      const membership = await this.getMembership(userId, workspaceId);
      if (!membership || membership.role !== WorkspaceRole.OWNER) {
        throw new ForbiddenException('Only workspace owners can update this workspace');
      }
    }
    const update: any = {};
    if (typeof data.name === 'string') {
      const name = data.name.trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      update.name = name;
    }
    return this.prisma.workspace.update({ where: { id: workspaceId }, data: update });
  }

  async deleteWorkspace(workspaceId: string, userId: string) {
    if (!workspaceId || !userId) throw new BadRequestException('workspaceId and userId are required');
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!this.isSystemAdmin(userId)) {
      const membership = await this.getMembership(userId, workspaceId);
      if (!membership || membership.role !== WorkspaceRole.OWNER) {
        throw new ForbiddenException('Only workspace owners can delete this workspace');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const dbIds = (await tx.database.findMany({ where: { workspaceId }, select: { id: true } })).map((d) => d.id);
      const pageIds = (await tx.page.findMany({ where: { workspaceId }, select: { id: true } })).map((p) => p.id);
      if (dbIds.length) {
        await tx.databaseRow.deleteMany({ where: { databaseId: { in: dbIds } } });
        await tx.databaseForm.deleteMany({ where: { databaseId: { in: dbIds } } });
        await tx.databaseField.deleteMany({ where: { databaseId: { in: dbIds } } });
        await tx.database.deleteMany({ where: { workspaceId } });
      }
      if (pageIds.length) {
        await tx.block.deleteMany({ where: { pageId: { in: pageIds } } });
        await tx.page.deleteMany({ where: { workspaceId } });
      }
      await tx.collabDoc.deleteMany({ where: { documentName: { startsWith: `ws:${workspaceId}:` } } });
      await tx.userWorkspace.deleteMany({ where: { workspaceId } });
      await tx.workspace.delete({ where: { id: workspaceId } });
    });
    return { ok: true };
  }

  async listWorkspaceMembers(userId: string | undefined, workspaceId: string, adminId?: string) {
    if (adminId) {
      this.ensureAdmin(adminId);
    } else if (!userId) {
      throw new Error('userId is required');
    } else {
      await this.requireMembership(userId, workspaceId);
    }
    return this.prisma.userWorkspace.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addWorkspaceMember(
    userId: string | undefined,
    workspaceId: string,
    payload: { email?: string; userId?: string; role?: WorkspaceRole },
    adminId?: string
  ) {
    if (adminId) {
      this.ensureAdmin(adminId);
    } else if (!userId) {
      throw new Error('userId is required');
    } else {
      await this.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    }
    const role: WorkspaceRole = payload.role && Object.values(WorkspaceRole).includes(payload.role) ? payload.role : WorkspaceRole.EDITOR;
    const user = await this.findUserForMembership(payload);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === user.id && role !== WorkspaceRole.OWNER) {
      throw new Error('Personal workspace owners must remain owners');
    }
    const membership = await this.prisma.userWorkspace.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      update: { role },
      create: { userId: user.id, workspaceId, role },
    });
    return membership;
  }

  // Members are existing accounts, found by email (or exact user ID). Never create a user
  // here: that used to turn a name or mistyped ID into an account nobody could log in to.
  private async findUserForMembership(payload: { email?: string; userId?: string }) {
    const email = payload.email?.trim().toLowerCase();
    if (email) {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) {
        throw new NotFoundException(`No user with the email ${email}. Create their account first (Admin → Users).`);
      }
      return user;
    }
    if (payload.userId && isUuid(payload.userId)) {
      const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) throw new NotFoundException('User not found');
      return user;
    }
    throw new BadRequestException('Enter the email address of the person to add');
  }

  async updateWorkspaceMemberRole(
    userId: string | undefined,
    workspaceId: string,
    memberId: string,
    role: WorkspaceRole,
    adminId?: string
  ) {
    if (adminId) {
      this.ensureAdmin(adminId);
    } else if (!userId) {
      throw new Error('userId is required');
    } else {
      await this.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    }
    const nextRole: WorkspaceRole = role && Object.values(WorkspaceRole).includes(role) ? role : WorkspaceRole.EDITOR;
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === memberId && nextRole !== WorkspaceRole.OWNER) {
      throw new Error('Personal workspace owners must remain owners');
    }
    const membership = await this.prisma.userWorkspace.findFirst({
      where: { userId: memberId, workspaceId },
      select: { id: true, role: true },
    });
    if (!membership) throw new Error('Membership not found');
    if (membership.role === WorkspaceRole.OWNER && nextRole !== WorkspaceRole.OWNER) {
      await this.ensureNotLastOwner(workspaceId);
    }
    return this.prisma.userWorkspace.update({
      where: { id: membership.id },
      data: { role: nextRole },
    });
  }

  async removeWorkspaceMember(userId: string | undefined, workspaceId: string, memberId: string, adminId?: string) {
    if (adminId) {
      this.ensureAdmin(adminId);
    } else if (!userId) {
      throw new Error('userId is required');
    } else {
      await this.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    }
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new Error('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === memberId) {
      throw new Error('Personal workspace owners must remain owners');
    }
    const membership = await this.prisma.userWorkspace.findFirst({
      where: { userId: memberId, workspaceId },
      select: { id: true, role: true },
    });
    if (!membership) {
      return { count: 0 };
    }
    if (membership.role === WorkspaceRole.OWNER) {
      await this.ensureNotLastOwner(workspaceId);
    }
    return this.prisma.userWorkspace.deleteMany({ where: { userId: memberId, workspaceId } });
  }

  async updatePage(id: string, data: { title?: string; icon?: string }, user?: { userId?: string; userName?: string }) {
    await this.requirePageAccess(id, user, { requireWrite: true });
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
        const titleFieldId = await this.resolveDatabaseTitleFieldId(row.databaseId);
        if (titleFieldId) {
          const rowData = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...(row.data as any) } : {};
          rowData[titleFieldId] = this.normalizePageTitle(data.title);
          await this.prisma.databaseRow.update({
            where: { id: row.id },
            data: { data: rowData },
          });
        }
      }
      await this.updateCollabTitleForPage(
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
      throw new Error('visibility is required');
    }
    const { page } = await this.requirePageAccess(id, user, { requireWrite: true });
    const descendantIds = await this.collectDescendantIds(id);
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
      throw new Error('Cannot move private pages you do not own');
    }
    const updateData: Prisma.PageUncheckedUpdateManyInput = { visibility: target };
    if (target === PageVisibility.PRIVATE) {
      if (!user?.userId) {
        throw new Error('userId is required');
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
    const { page } = await this.requirePageAccess(pageId, user, { requireWrite: true });
    if (page.workspaceId === targetWorkspaceId) {
      throw new BadRequestException('Page is already in that workspace');
    }
    const userId = user?.userId!;
    const targetMembership = await this.requireMembership(userId, targetWorkspaceId);
    if (!this.canEdit(targetMembership.role)) {
      throw new ForbiddenException('Editor access required in the target workspace');
    }
    const descendantIds = await this.collectDescendantIds(pageId);
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

  async issueCollabToken(payload: { userId?: string; userName?: string; workspaceId?: string }) {
    const { userId, userName, workspaceId } = payload;
    if (!this.collabJwtSecret) {
      throw new Error('COLLAB_JWT_SECRET is not configured on the API');
    }
    if (!userId) {
      throw new Error('userId is required');
    }
    const user = await this.ensureUser(userId, userName);
    const memberships = await this.getWorkspaceMemberships(user.id);
    const editable = memberships.filter((m) => m.role !== WorkspaceRole.VIEWER).map((m) => m.workspaceId);
    if (!editable.length) {
      throw new Error('No workspace access for user');
    }

    let allowedWorkspaces = editable;
    if (workspaceId) {
      if (!editable.includes(workspaceId)) {
        throw new Error('User does not have edit access to requested workspace');
      }
      allowedWorkspaces = [workspaceId];
    }

    const token = jwt.sign({ sub: user.id, workspaceIds: allowedWorkspaces }, this.collabJwtSecret, { expiresIn: '12h' });
    return { token, workspaceIds: allowedWorkspaces };
  }

  async listBlocksForPage(pageId: string, user?: { userId?: string; userName?: string }) {
    await this.requirePageAccess(pageId, user);
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
    await this.requirePageAccess(pageId, user, { requireWrite: true });
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
    if (!block) throw new Error('Block not found');
    await this.requirePageAccess(block.pageId, user, { requireWrite: true });
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
      throw new Error('workspaceId is required');
    }
    if (!body.userId) {
      throw new Error('userId is required');
    }
    const workspace = await this.resolveWorkspaceByKeyOrId(body.workspaceId, body.userId, body.userName);
    const membership = await this.requireMembership(body.userId, workspace.id);
    if (!this.canEdit(membership.role)) {
      throw new Error('Forbidden: editor access required');
    }
    const parentId = body.parentId ?? null;
    const position = await this.nextPosition(workspace.id, parentId);
    const kind: PageKind = body.kind && Object.values(PageKind).includes(body.kind) ? body.kind : PageKind.DOC;
    let visibility: PageVisibility = body.visibility && Object.values(PageVisibility).includes(body.visibility) ? body.visibility : PageVisibility.PUBLIC;
    const setupStatus: PageSetupStatus =
      body.setupStatus && Object.values(PageSetupStatus).includes(body.setupStatus) ? body.setupStatus : PageSetupStatus.COMPLETE;
    let wikiHomeId: string | null = null;
    if (parentId) {
      const parent = await this.requirePageAccess(parentId, { userId: body.userId, userName: body.userName }, { requireWrite: true });
      if (parent.page.workspaceId !== workspace.id) {
        throw new Error('parent does not exist in workspace');
      }
      visibility = parent.page.visibility;
      wikiHomeId = parent.page.wikiHomeId ?? null;
    }
    if (visibility === PageVisibility.PRIVATE && !body.userId) {
      throw new Error('Private pages require an author');
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
      const setupConfig = this.resolveDatabaseSetupConfig(body.database);
      await this.createDatabaseForPage(
        page.id,
        workspace.id,
        { complianceMode, fields: setupConfig.fields, workflowConfig: setupConfig.workflowConfig },
        { userId: body.userId, userName: body.userName }
      );
    }
    if (page.wikiHomeId) {
      await this.ensureWikiRowForPage(page);
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
    const { page } = await this.requirePageAccess(id, user, { requireWrite: true });
    const nextKind = payload.kind && Object.values(PageKind).includes(payload.kind) ? payload.kind : undefined;
    const nextStatus =
      payload.setupStatus && Object.values(PageSetupStatus).includes(payload.setupStatus) ? payload.setupStatus : undefined;
    const nextComplianceMode = typeof payload.complianceMode === 'boolean' ? payload.complianceMode : undefined;
    const setupConfig = this.resolveDatabaseSetupConfig(payload.database);

    if (!nextKind && !nextStatus && nextComplianceMode === undefined) {
      throw new Error('kind, setupStatus, or complianceMode is required');
    }

    if (page.setupStatus === PageSetupStatus.COMPLETE) {
      if ((nextStatus && nextStatus !== PageSetupStatus.COMPLETE) || (nextKind && nextKind !== page.kind)) {
        throw new Error('Setup already completed');
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
        throw new Error('Page type can only be changed while setup is pending');
      }
      if (nextKind === PageKind.DATABASE) {
        const existing = await this.prisma.database.findUnique({ where: { pageId: page.id }, select: { id: true } });
        if (!existing) {
          await this.createDatabaseForPage(page.id, page.workspaceId, {
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
          await this.prisma.databaseRow.deleteMany({ where: { databaseId: database.id } });
          await this.prisma.databaseField.deleteMany({ where: { databaseId: database.id } });
          await this.prisma.database.deleteMany({ where: { id: database.id } });
        }
      }
    }

    const completing = nextStatus === PageSetupStatus.COMPLETE && page.setupStatus !== PageSetupStatus.COMPLETE;
    const finalKind = nextKind || page.kind;
    if (completing && finalKind === PageKind.DATABASE) {
      const existing = await this.prisma.database.findUnique({ where: { pageId: page.id }, select: { id: true } });
      if (!existing) {
        await this.createDatabaseForPage(page.id, page.workspaceId, {
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

  async convertPageToWiki(pageId: string, user?: { userId?: string; userName?: string }) {
    const { page } = await this.requirePageAccess(pageId, user, { requireWrite: true });
    if (page.kind !== PageKind.DOC) {
      throw new Error('Only document pages can be wiki homes');
    }
    const wikiHomeId = page.id;
    const descendantIds = await this.collectDescendantIds(page.id);
    await this.prisma.page.updateMany({
      where: { id: { in: [page.id, ...descendantIds] } },
      data: { wikiHomeId },
    });

    const databasePage = await this.ensureWikiDatabase(page, user);
    await this.ensureWikiRowsForHome(wikiHomeId);

    const { wikiConfig } = await this.prisma.page.findUniqueOrThrow({ where: { id: page.id }, select: { wikiConfig: true } });
    const existingConfig =
      wikiConfig && typeof wikiConfig === 'object' && !Array.isArray(wikiConfig)
        ? (wikiConfig as Record<string, any>)
        : null;
    const nextConfig = existingConfig
      ? { ...existingConfig, databasePageId: databasePage.id }
      : this.buildWikiConfig(databasePage.id);

    const updated = await this.prisma.page.update({
      where: { id: page.id },
      data: { wikiConfig: nextConfig, wikiHomeId },
    });

    return { page: updated, databasePage };
  }

  private async createDatabaseForPage(
    pageId: string,
    workspaceId: string,
    options: {
      complianceMode?: boolean;
      fields?: Array<{
        name: string;
        type: DatabaseFieldType;
        options: Prisma.JsonValue;
        position: Prisma.Decimal;
      }>;
      workflowConfig?: Prisma.InputJsonValue | null;
    } = {},
    user?: { userId?: string; userName?: string }
  ) {
    const complianceMode = typeof options.complianceMode === 'boolean' ? options.complianceMode : false;
    const database = await this.prisma.database.create({
      data: { pageId, workspaceId, complianceMode },
    });
    const fields = Array.isArray(options.fields) ? options.fields : [];
    const fieldsToCreate = fields.length
      ? fields
      : [
          {
            name: this.DEFAULT_DB_FIELD_NAME,
            type: DatabaseFieldType.TEXT,
            position: this.POSITION_INCREMENT,
            options: { source: 'page' },
          },
        ];
    const sanitizedFields = await Promise.all(
      fieldsToCreate.map(async (field) => ({
        ...field,
        options: await this.sanitizeDatabaseFieldOptions({ workspaceId, complianceMode }, field.type, field.options ?? {}),
      }))
    );
    const createdFields = await this.prisma.$transaction(
      sanitizedFields.map((field) =>
        this.prisma.databaseField.create({
          data: {
            databaseId: database.id,
            name: field.name,
            type: field.type,
            position: field.position,
            options: field.options ?? {},
          },
        })
      )
    );
    if (complianceMode) {
      const workflowConfig = this.normalizeWorkflowConfig(options.workflowConfig) || this.DEFAULT_COMPLIANCE_WORKFLOW;
      await this.compliance.createWorkflowVersion(
        {
          workspaceId,
          databaseId: database.id,
          config: workflowConfig,
        },
        user
      );
      await this.compliance.createSchemaVersion(
        {
          workspaceId,
          databaseId: database.id,
          schema: this.buildComplianceSchema(createdFields),
        },
        user
      );
    }
    return database;
  }

  private buildWikiConfig(databasePageId: string) {
    return {
      databasePageId,
      views: [
        { id: 'home', name: 'Home', type: 'home' },
        { id: 'all-pages', name: 'All Pages', type: 'table', pageId: databasePageId },
        { id: 'gallery', name: 'Gallery', type: 'gallery' },
      ],
    };
  }

  private getWikiDatabasePageIdFromConfig(config: Prisma.JsonValue | null | undefined) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
    const raw = (config as Record<string, any>).databasePageId;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  private getFieldSource(options: Prisma.JsonValue | null | undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    const raw = (options as Record<string, any>).source;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }

  private getAssetTagFieldIds(fields: Array<{ id: string; options?: Prisma.JsonValue | null }>) {
    return fields
      .filter((field) => this.getFieldSource(field.options) === 'assetTag')
      .map((field) => field.id);
  }

  private applyAssetTagValues(data: Record<string, any>, fieldIds: string[], value: string) {
    if (!fieldIds.length) return data;
    const next = { ...data };
    fieldIds.forEach((fieldId) => {
      next[fieldId] = value;
    });
    return next;
  }

  private applyAssetTagValuesFromExisting(
    data: Record<string, any>,
    fieldIds: string[],
    existing: Record<string, any> | null,
    fallbackValue: string
  ) {
    if (!fieldIds.length) return data;
    const next = { ...data };
    fieldIds.forEach((fieldId) => {
      const existingValue = existing ? existing[fieldId] : undefined;
      if (typeof existingValue === 'string' && existingValue.trim()) {
        next[fieldId] = existingValue.trim();
      } else {
        next[fieldId] = fallbackValue;
      }
    });
    return next;
  }

  private normalizePageTitle(value: unknown) {
    if (typeof value === 'string') return value.trim();
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  private normalizeWorkflowConfig(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Prisma.InputJsonValue;
  }

  private normalizeDatabaseFieldInputs(raw: unknown) {
    if (!Array.isArray(raw)) return [];
    const normalized: Array<{
      name: string;
      type: DatabaseFieldType;
      options: Prisma.JsonValue;
      position: Prisma.Decimal;
    }> = [];
    raw.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') return;
      const name = typeof (entry as any).name === 'string' ? (entry as any).name.trim() : '';
      if (!name) return;
      const type = (entry as any).type;
      const resolvedType =
        type && Object.values(DatabaseFieldType).includes(type) ? (type as DatabaseFieldType) : DatabaseFieldType.TEXT;
      const rawOptions = (entry as any).options;
      const options =
        rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)
          ? (rawOptions as Prisma.JsonValue)
          : {};
      const rawPosition = (entry as any).position;
      const posNumber = typeof rawPosition === 'string' || typeof rawPosition === 'number' ? Number(rawPosition) : NaN;
      const position = Number.isFinite(posNumber) ? new Prisma.Decimal(posNumber) : new Prisma.Decimal(index + 1);
      normalized.push({ name, type: resolvedType, options, position });
    });
    if (!normalized.length) return normalized;
    const hasTitleField = normalized.some((field) => this.getFieldSource(field.options) === 'page');
    if (!hasTitleField) {
      const first = normalized[0];
      const options =
        first.options && typeof first.options === 'object' && !Array.isArray(first.options)
          ? { ...(first.options as Record<string, any>), source: 'page' }
          : { source: 'page' };
      normalized[0] = { ...first, type: DatabaseFieldType.TEXT, options };
    }
    return normalized;
  }

  private resolveDatabaseSetupConfig(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        fields: [] as Array<{
          name: string;
          type: DatabaseFieldType;
          options: Prisma.JsonValue;
          position: Prisma.Decimal;
        }>,
        workflowConfig: null,
      };
    }
    const raw = value as Record<string, any>;
    const template = typeof raw.template === 'string' ? raw.template.trim().toLowerCase() : '';
    let fields = this.normalizeDatabaseFieldInputs(raw.fields);
    if (!fields.length && template === 'inventory') {
      fields = this.normalizeDatabaseFieldInputs(INVENTORY_TEMPLATE_FIELDS);
    }
    if (!fields.length && template === 'maintenance') {
      fields = this.normalizeDatabaseFieldInputs(MAINTENANCE_TEMPLATE_FIELDS);
    }
    if (!fields.length && template === 'assignments') {
      fields = this.normalizeDatabaseFieldInputs(ASSIGNMENTS_TEMPLATE_FIELDS);
    }
    const workflowConfig = this.normalizeWorkflowConfig(raw.workflow);
    return { fields, workflowConfig };
  }

  private async ensureDatabaseTitleField(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
    });
    const pageField = fields.find((field) => this.getFieldSource(field.options) === 'page') || null;
    if (pageField) {
      return { field: pageField, updated: false };
    }
    if (!fields.length) {
      return { field: null, updated: false };
    }
    const target = fields[0];
    const options =
      target.options && typeof target.options === 'object' && !Array.isArray(target.options)
        ? { ...(target.options as Record<string, any>), source: 'page' }
        : { source: 'page' };
    const updatedField = await this.prisma.databaseField.update({
      where: { id: target.id },
      data: {
        type: DatabaseFieldType.TEXT,
        options,
      },
    });
    return { field: updatedField, updated: true };
  }

  private async resolveDatabaseTitleFieldId(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
      select: { id: true, options: true },
    });
    const pageField = fields.find((field) => this.getFieldSource(field.options) === 'page');
    if (pageField) return pageField.id;
    return fields[0]?.id || null;
  }

  private async findWikiDatabasePage(wikiHomeId: string) {
    return this.prisma.page.findFirst({
      where: {
        wikiHomeId,
        kind: PageKind.DATABASE,
        isHidden: true,
        isDeleted: false,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async resolveWikiOwnersFieldId(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, name: true, options: true, type: true },
    });
    const sourceField = fields.find((field) => this.getFieldSource(field.options) === 'members');
    if (sourceField) return sourceField.id;
    const byName = fields.find((field) => field.name === 'Owners');
    return byName?.id || null;
  }

  private async resolveWikiDatabasePage(wikiHomeId: string) {
    const home = await this.prisma.page.findUnique({
      where: { id: wikiHomeId },
      select: { wikiConfig: true },
    });
    const configuredId = this.getWikiDatabasePageIdFromConfig(home?.wikiConfig);
    if (configuredId) {
      const configured = await this.prisma.page.findFirst({
        where: { id: configuredId, kind: PageKind.DATABASE, isDeleted: false },
      });
      if (configured) return configured;
    }
    const hidden = await this.findWikiDatabasePage(wikiHomeId);
    if (hidden) return hidden;
    const byTitle = await this.prisma.page.findFirst({
      where: {
        wikiHomeId,
        kind: PageKind.DATABASE,
        isDeleted: false,
        title: 'All Pages',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (byTitle) return byTitle;
    return this.prisma.page.findFirst({
      where: { wikiHomeId, kind: PageKind.DATABASE, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async resolveWikiHomeIdForDatabasePage(page: { id: string; wikiHomeId: string | null; parentId?: string | null }) {
    if (page.wikiHomeId) return page.wikiHomeId;
    if (page.parentId) {
      const parent = await this.prisma.page.findUnique({
        where: { id: page.parentId },
        select: { id: true, wikiHomeId: true },
      });
      if (parent?.id && parent.id === parent.wikiHomeId) return parent.id;
      if (parent?.wikiHomeId) return parent.wikiHomeId;
    }
    const referrers = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
      FROM "Page"
      WHERE "wikiConfig"->>'databasePageId' = ${page.id}
      LIMIT 1
    `;
    return referrers?.[0]?.id || null;
  }

  private async seedWikiDatabaseFields(databaseId: string) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      orderBy: { position: 'asc' },
    });
    const bySource = (source: string) =>
      fields.find((field) => {
        const options = field.options as Record<string, any> | null;
        return options && typeof options === 'object' && !Array.isArray(options) && options.source === source;
      }) || null;

    const updates: Prisma.PrismaPromise<any>[] = [];
    const pageField = bySource('page') || fields[0] || null;
    if (pageField) {
      updates.push(
        this.prisma.databaseField.update({
          where: { id: pageField.id },
          data: {
            name: 'Page',
            type: DatabaseFieldType.TEXT,
            options: { source: 'page', readonly: true },
            position: 1,
          },
        })
      );
    } else {
      updates.push(
        this.prisma.databaseField.create({
          data: {
            databaseId,
            name: 'Page',
            type: DatabaseFieldType.TEXT,
            options: { source: 'page', readonly: true },
            position: 1,
          },
        })
      );
    }

    const ensureField = (source: string | null, name: string, type: DatabaseFieldType, position: number, options: Record<string, any>) => {
      const existing =
        (source && bySource(source)) ||
        fields.find((field) => field.name === name) ||
        null;
      if (existing) {
        updates.push(
          this.prisma.databaseField.update({
            where: { id: existing.id },
            data: {
              name,
              type,
              options,
              position,
            },
          })
        );
        return;
      }
      updates.push(
        this.prisma.databaseField.create({
          data: {
            databaseId,
            name,
            type,
            options,
            position,
          },
        })
      );
    };

    ensureField('members', 'Owners', DatabaseFieldType.MULTI_SELECT, 2, { source: 'members' });
    ensureField(null, 'Tags', DatabaseFieldType.MULTI_SELECT, 3, { choices: [] });
    ensureField('lastEdited', 'Last edited', DatabaseFieldType.DATE, 4, { source: 'lastEdited', readonly: true });

    if (updates.length) {
      await this.prisma.$transaction(updates);
    }
  }

  private async createDatabaseRowPage(
    databasePage: { id: string; workspaceId: string; visibility: PageVisibility; wikiHomeId: string | null },
    title: string,
    user?: { userId?: string }
  ) {
    const wikiHomeId = databasePage.wikiHomeId || null;
    const parentId = wikiHomeId || databasePage.id;
    const pageTitle = title || 'Untitled page';
    const authorId = isUuid(user?.userId) ? user?.userId : null;
    return this.prisma.page.create({
      data: {
        workspaceId: databasePage.workspaceId,
        parentId,
        wikiHomeId,
        title: pageTitle,
        content: normalizeEditorContent(null),
        kind: PageKind.DOC,
        visibility: databasePage.visibility,
        setupStatus: PageSetupStatus.COMPLETE,
        authorId,
        isHidden: !wikiHomeId,
      },
    });
  }

  private async ensureWikiDatabase(page: { id: string; workspaceId: string; visibility: PageVisibility }, user?: { userId?: string }) {
    let databasePage = await this.findWikiDatabasePage(page.id);
    if (!databasePage) {
      const authorId = isUuid(user?.userId) ? user?.userId : null;
      databasePage = await this.prisma.page.create({
        data: {
          workspaceId: page.workspaceId,
          parentId: page.id,
          wikiHomeId: page.id,
          title: 'All Pages',
          content: normalizeEditorContent(null),
          kind: PageKind.DATABASE,
          visibility: page.visibility,
          setupStatus: PageSetupStatus.COMPLETE,
          authorId,
          isHidden: true,
        },
      });
    }
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePage.id } });
    if (!database) {
      await this.createDatabaseForPage(databasePage.id, databasePage.workspaceId);
    }
    const refreshedDatabase = await this.prisma.database.findUniqueOrThrow({ where: { pageId: databasePage.id } });
    await this.seedWikiDatabaseFields(refreshedDatabase.id);
    return databasePage;
  }

  private async ensureWikiRowForPage(page: { id: string; wikiHomeId: string | null; isDeleted?: boolean; kind?: PageKind; isHidden?: boolean }) {
    if (!page.wikiHomeId) return;
    if (page.wikiHomeId === page.id) return;
    if (page.isDeleted) return;
    if (page.isHidden) return;
    if (page.kind && page.kind !== PageKind.DOC) return;
    const databasePage = await this.resolveWikiDatabasePage(page.wikiHomeId);
    if (!databasePage) return;
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePage.id } });
    if (!database) {
      await this.createDatabaseForPage(databasePage.id, databasePage.workspaceId);
    }
    const ensuredDatabase = await this.prisma.database.findUniqueOrThrow({ where: { pageId: databasePage.id } });
    await this.seedWikiDatabaseFields(ensuredDatabase.id);
    const position = await this.nextDatabaseRowPosition(ensuredDatabase.id);
    const ownersFieldId = await this.resolveWikiOwnersFieldId(ensuredDatabase.id);
    const authorId = 'authorId' in page ? (page as { authorId?: string | null }).authorId : null;
    const data =
      ownersFieldId && authorId && isUuid(authorId)
        ? { [ownersFieldId]: [authorId] }
        : {};
    await this.prisma.databaseRow.upsert({
      where: { databaseId_pageId: { databaseId: ensuredDatabase.id, pageId: page.id } },
      update: {},
      create: {
        databaseId: ensuredDatabase.id,
        pageId: page.id,
        data,
        position,
      },
    });
  }

  private async ensureWikiRowsForHome(wikiHomeId: string) {
    const databasePage = await this.resolveWikiDatabasePage(wikiHomeId);
    if (!databasePage) return;
    const database = await this.prisma.database.findUnique({ where: { pageId: databasePage.id } });
    if (!database) {
      await this.createDatabaseForPage(databasePage.id, databasePage.workspaceId);
    }
    const ensuredDatabase = await this.prisma.database.findUniqueOrThrow({ where: { pageId: databasePage.id } });
    await this.seedWikiDatabaseFields(ensuredDatabase.id);
    const pages = await this.prisma.page.findMany({
      where: {
        wikiHomeId,
        isDeleted: false,
        isHidden: false,
        kind: PageKind.DOC,
        NOT: { id: wikiHomeId },
      },
      select: { id: true, authorId: true },
    });
    const ownersFieldId = await this.resolveWikiOwnersFieldId(ensuredDatabase.id);
    const existingRows = await this.prisma.databaseRow.findMany({
      where: { databaseId: ensuredDatabase.id, pageId: { not: null } },
      select: { pageId: true },
    });
    const existingIds = new Set(existingRows.map((row) => row.pageId).filter(Boolean));
    const lastPosition = await this.prisma.databaseRow.findFirst({
      where: { databaseId: ensuredDatabase.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    let nextPosition = lastPosition?.position ? lastPosition.position.plus(this.POSITION_INCREMENT) : this.POSITION_INCREMENT;
    const rowsToCreate = [];
    for (const page of pages) {
      if (!page.id || existingIds.has(page.id)) continue;
      const data =
        ownersFieldId && page.authorId && isUuid(page.authorId)
          ? { [ownersFieldId]: [page.authorId] }
          : {};
      const position = nextPosition;
      nextPosition = nextPosition.plus(this.POSITION_INCREMENT);
      rowsToCreate.push(
        this.prisma.databaseRow.create({
          data: {
            databaseId: ensuredDatabase.id,
            pageId: page.id,
            data,
            position,
          },
        })
      );
    }
    if (rowsToCreate.length) {
      await this.prisma.$transaction(rowsToCreate);
    }
  }

  private async getDatabaseForPage(
    pageId: string,
    user?: { userId?: string; userName?: string },
    options: { requireWrite?: boolean } = {}
  ) {
    const { page } = await this.requirePageAccess(pageId, user, { requireWrite: options.requireWrite });
    if (page.kind !== PageKind.DATABASE) {
      throw new Error('Page is not a database');
    }
    const wikiHomeId = await this.resolveWikiHomeIdForDatabasePage(page);
    if (wikiHomeId) {
      await this.ensureWikiRowsForHome(wikiHomeId);
    }
    const include = {
      fields: { orderBy: { position: 'asc' } },
      rows: { orderBy: { position: 'asc' } },
      forms: { orderBy: { position: 'asc' } },
      views: { orderBy: { position: 'asc' } },
    } satisfies Prisma.DatabaseInclude;
    let database = await this.prisma.database.findUnique({ where: { pageId }, include });
    if (!database) {
      await this.createDatabaseForPage(pageId, page.workspaceId);
      database = await this.prisma.database.findUniqueOrThrow({ where: { pageId }, include });
    }
    if (!wikiHomeId) {
      const { field, updated } = await this.ensureDatabaseTitleField(database.id);
      if (updated && field) {
        database.fields = database.fields.map((existing) => (existing.id === field.id ? { ...existing, ...field } : existing));
      }
    }
    return database;
  }

  private async nextDatabaseFieldPosition(databaseId: string) {
    const last = await this.prisma.databaseField.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(this.POSITION_INCREMENT) : this.POSITION_INCREMENT;
  }

  private async nextDatabaseRowPosition(databaseId: string) {
    const last = await this.prisma.databaseRow.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(this.POSITION_INCREMENT) : this.POSITION_INCREMENT;
  }

  private async nextDatabaseFormPosition(databaseId: string) {
    const last = await this.prisma.databaseForm.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(this.POSITION_INCREMENT) : this.POSITION_INCREMENT;
  }

  private normalizeDatabaseFieldOptions(options: Prisma.JsonValue | null | undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { choices: null as { value: string; color?: string | null }[] | null, choiceValues: null as string[] | null };
    }
    const rawChoices = (options as any).choices;
    const choices = Array.isArray(rawChoices)
      ? rawChoices
          .map((choice) => {
            if (typeof choice === 'string') {
              const value = choice.trim();
              return value ? { value, color: null } : null;
            }
            if (choice && typeof choice === 'object') {
              const value = typeof (choice as any).value === 'string' ? (choice as any).value.trim() : '';
              if (!value) return null;
              const color = typeof (choice as any).color === 'string' ? (choice as any).color.trim() : null;
              return { value, color: color || null };
            }
            return null;
          })
          .filter((choice): choice is NonNullable<typeof choice> => !!choice)
      : null;
    const choiceValues = choices ? choices.map((choice) => choice.value) : null;
    return { ...(options as Record<string, any>), choices, choiceValues };
  }

  private normalizeRelationHistory(relation: Record<string, any>) {
    const raw = relation?.history;
    if (raw === true) {
      return { enabled: true, pageId: null as string | null };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const enabled = raw.enabled === true;
    const pageId = typeof raw.pageId === 'string' ? raw.pageId.trim() : '';
    return enabled ? { enabled: true, pageId: isUuid(pageId) ? pageId : null } : null;
  }

  private normalizeRelationOptions(options: Prisma.JsonValue | null | undefined) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
    const relation = (options as Record<string, any>).relation;
    if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return null;
    const pageId = typeof (relation as any).pageId === 'string' ? (relation as any).pageId.trim() : '';
    if (!pageId || !isUuid(pageId)) return null;
    const allowMultiple = (relation as any).allowMultiple === true;
    const history = this.normalizeRelationHistory(relation);
    return { pageId, allowMultiple, history };
  }

  private normalizeRelationEntry(value: any) {
    if (typeof value === 'string') {
      const id = value.trim();
      if (!isUuid(id)) return null;
      return { id, label: '' };
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rawId = typeof (value as any).id === 'string' ? (value as any).id.trim() : '';
    if (!rawId || !isUuid(rawId)) return null;
    const rawLabel = typeof (value as any).label === 'string' ? (value as any).label.trim() : '';
    return { id: rawId, label: rawLabel };
  }

  private collectRelationEntries(value: any) {
    if (!value) return [];
    const list = Array.isArray(value) ? value : [value];
    return list.map((entry) => this.normalizeRelationEntry(entry)).filter(Boolean) as Array<{ id: string; label: string }>;
  }

  private resolveTitleFromData(data: Record<string, any> | null, titleFieldId: string | null, fallbackId: string) {
    if (!data || !titleFieldId) return fallbackId;
    const raw = data[titleFieldId];
    if (Array.isArray(raw)) {
      const joined = raw.map((item) => String(item ?? '')).filter(Boolean).join(', ');
      return joined || fallbackId;
    }
    if (raw !== null && raw !== undefined) {
      const value = String(raw).trim();
      if (value) return value;
    }
    return fallbackId;
  }

  private async ensureRelationHistoryDatabase(
    database: { pageId: string; workspaceId: string; complianceMode: boolean },
    relation: { pageId: string },
    fieldName: string,
    user?: { userId?: string; userName?: string }
  ) {
    const sourcePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, title: true, parentId: true, visibility: true },
    });
    const targetPage = await this.prisma.page.findUnique({
      where: { id: relation.pageId },
      select: { title: true },
    });
    const sourceTitle = sourcePage?.title?.trim() || 'Database';
    const targetTitle = targetPage?.title?.trim() || 'Database';
    const fieldLabel = fieldName?.trim() || 'Relation';
    const title = `${sourceTitle} - ${fieldLabel} History`;
    const fields = [
      { name: this.RELATION_HISTORY_FIELDS.title, type: DatabaseFieldType.TEXT, options: { source: 'page' }, position: 1 },
      {
        name: this.RELATION_HISTORY_FIELDS.source,
        type: DatabaseFieldType.RELATION,
        options: { relation: { pageId: database.pageId, allowMultiple: false } },
        position: 2,
      },
      {
        name: `${this.RELATION_HISTORY_FIELDS.target} (${targetTitle})`,
        type: DatabaseFieldType.RELATION,
        options: { relation: { pageId: relation.pageId, allowMultiple: false } },
        position: 3,
      },
      {
        name: this.RELATION_HISTORY_FIELDS.action,
        type: DatabaseFieldType.SELECT,
        options: { choices: [this.RELATION_HISTORY_ACTIONS.added, this.RELATION_HISTORY_ACTIONS.removed] },
        position: 4,
      },
      { name: this.RELATION_HISTORY_FIELDS.changedAt, type: DatabaseFieldType.DATE, options: {}, position: 5 },
      { name: this.RELATION_HISTORY_FIELDS.changedBy, type: DatabaseFieldType.TEXT, options: {}, position: 6 },
    ];
    const created = await this.createPage({
      workspaceId: database.workspaceId,
      title,
      parentId: sourcePage?.id || undefined,
      kind: PageKind.DATABASE,
      visibility: sourcePage?.visibility || PageVisibility.PUBLIC,
      setupStatus: PageSetupStatus.COMPLETE,
      complianceMode: database.complianceMode,
      userId: user?.userId,
      userName: user?.userName,
      database: { fields },
    });
    if (!created?.id) {
      throw new Error('Failed to create relation history database.');
    }
    return created.id as string;
  }

  private async ensureRelationHistoryOptions(
    database: { pageId: string; workspaceId: string; complianceMode: boolean },
    fieldName: string,
    options: Prisma.InputJsonValue,
    user?: { userId?: string; userName?: string }
  ) {
    const relation = this.normalizeRelationOptions(options as Prisma.JsonValue);
    if (!relation?.history?.enabled) return options;
    if (relation.history.pageId && relation.history.pageId === database.pageId) {
      throw new Error('Relation history database must be different from the source database.');
    }
    if (relation.history.pageId) return options;
    const logPageId = await this.ensureRelationHistoryDatabase(database, relation, fieldName, user);
    return {
      ...(options && typeof options === 'object' && !Array.isArray(options) ? (options as Record<string, any>) : {}),
      relation: {
        pageId: relation.pageId,
        allowMultiple: relation.allowMultiple,
        history: { enabled: true, pageId: logPageId },
      },
    };
  }

  private async resolveRelationHistoryFieldIds(
    logDatabaseId: string,
    sourcePageId: string,
    targetPageId: string
  ) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId: logDatabaseId },
      select: { id: true, name: true, type: true, options: true },
    });
    const titleFieldId = fields.find((field) => this.getFieldSource(field.options) === 'page')?.id || null;
    const actionFieldId = fields.find((field) => field.name === this.RELATION_HISTORY_FIELDS.action)?.id || null;
    const changedAtFieldId = fields.find((field) => field.name === this.RELATION_HISTORY_FIELDS.changedAt)?.id || null;
    const changedByFieldId = fields.find((field) => field.name === this.RELATION_HISTORY_FIELDS.changedBy)?.id || null;
    const sourceFieldId =
      fields.find((field) => {
        if (field.type !== DatabaseFieldType.RELATION) return false;
        const relation = this.normalizeRelationOptions(field.options ?? null);
        return relation?.pageId === sourcePageId;
      })?.id || null;
    const targetFieldId =
      fields.find((field) => {
        if (field.type !== DatabaseFieldType.RELATION) return false;
        const relation = this.normalizeRelationOptions(field.options ?? null);
        return relation?.pageId === targetPageId;
      })?.id || null;
    return { titleFieldId, actionFieldId, changedAtFieldId, changedByFieldId, sourceFieldId, targetFieldId };
  }

  private async logRelationHistoryChanges(params: {
    database: { id: string; pageId: string; workspaceId: string; complianceMode: boolean };
    fields: Array<{ id: string; name: string; type: DatabaseFieldType; options?: Prisma.JsonValue | null }>;
    rowId: string;
    previousData: Record<string, any> | null;
    nextData: Record<string, any> | null;
    user?: { userId?: string; userName?: string };
  }) {
    const { database, fields, rowId, previousData, nextData, user } = params;
    const historyFields = fields
      .filter((field) => field.type === DatabaseFieldType.RELATION)
      .map((field) => {
        const relation = this.normalizeRelationOptions(field.options ?? null);
        if (!relation?.history?.enabled || !relation.history.pageId) return null;
        if (relation.history.pageId === database.pageId) return null;
        return {
          fieldId: field.id,
          fieldName: field.name,
          relationPageId: relation.pageId,
          logPageId: relation.history.pageId,
        };
      })
      .filter(Boolean) as Array<{ fieldId: string; fieldName: string; relationPageId: string; logPageId: string }>;
    if (!historyFields.length) return;

    const titleFieldId = await this.resolveDatabaseTitleFieldId(database.id);
    const sourceLabel = this.resolveTitleFromData(nextData || previousData || null, titleFieldId, rowId);
    const now = new Date().toISOString();
    const changedBy = user?.userName || user?.userId || '';
    const logEntries: Array<{ logPageId: string; data: Record<string, any> }> = [];
    const logFieldCache = new Map<string, Awaited<ReturnType<typeof this.resolveRelationHistoryFieldIds>>>();

    for (const field of historyFields) {
      const beforeEntries = this.collectRelationEntries(previousData?.[field.fieldId]);
      const afterEntries = this.collectRelationEntries(nextData?.[field.fieldId]);
      const beforeMap = new Map(beforeEntries.map((entry) => [entry.id, entry]));
      const afterMap = new Map(afterEntries.map((entry) => [entry.id, entry]));
      const addedIds = [...afterMap.keys()].filter((id) => !beforeMap.has(id));
      const removedIds = [...beforeMap.keys()].filter((id) => !afterMap.has(id));
      if (!addedIds.length && !removedIds.length) continue;

      let logFields = logFieldCache.get(field.logPageId);
      if (!logFields) {
        const logDb = await this.prisma.database.findUnique({
          where: { pageId: field.logPageId },
          select: { id: true },
        });
        if (!logDb) continue;
        logFields = await this.resolveRelationHistoryFieldIds(logDb.id, database.pageId, field.relationPageId);
        logFieldCache.set(field.logPageId, logFields);
      }
      const { sourceFieldId, targetFieldId } = logFields;
      if (!sourceFieldId || !targetFieldId) continue;

      const pushEntry = (action: string, entry: { id: string; label: string }) => {
        const data: Record<string, any> = {};
        if (logFields.titleFieldId) {
          data[logFields.titleFieldId] = `${action}: ${entry.label || entry.id}`;
        }
        data[sourceFieldId] = { id: rowId, label: sourceLabel };
        data[targetFieldId] = { id: entry.id, label: entry.label || entry.id };
        if (logFields.actionFieldId) data[logFields.actionFieldId] = action;
        if (logFields.changedAtFieldId) data[logFields.changedAtFieldId] = now;
        if (logFields.changedByFieldId && changedBy) data[logFields.changedByFieldId] = changedBy;
        logEntries.push({ logPageId: field.logPageId, data });
      };

      addedIds.forEach((id) => {
        const entry = afterMap.get(id);
        if (entry) pushEntry(this.RELATION_HISTORY_ACTIONS.added, entry);
      });
      removedIds.forEach((id) => {
        const entry = beforeMap.get(id);
        if (entry) pushEntry(this.RELATION_HISTORY_ACTIONS.removed, entry);
      });
    }

    for (const entry of logEntries) {
      try {
        await this.createDatabaseRow(entry.logPageId, { data: entry.data }, user);
      } catch (err) {
        console.warn('Failed to log relation history', { logPageId: entry.logPageId, error: err });
      }
    }
  }

  private coerceRelationValue(value: any, allowMultiple: boolean) {
    const normalizeEntry = (entry: any) => {
      if (typeof entry === 'string') {
        const id = entry.trim();
        if (!isUuid(id)) return null;
        return { id, label: '' };
      }
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const rawId = typeof (entry as any).id === 'string' ? (entry as any).id.trim() : '';
      if (!rawId || !isUuid(rawId)) return null;
      const rawLabel = typeof (entry as any).label === 'string' ? (entry as any).label.trim() : '';
      return { id: rawId, label: rawLabel };
    };
    if (allowMultiple) {
      const list = Array.isArray(value) ? value : [value];
      const entries = list.map((entry) => normalizeEntry(entry)).filter(Boolean) as Array<{ id: string; label: string }>;
      return entries.length ? entries : undefined;
    }
    const entry = normalizeEntry(value);
    return entry || undefined;
  }

  private async sanitizeDatabaseFieldOptions(
    database: { workspaceId: string; complianceMode: boolean },
    type: DatabaseFieldType,
    rawOptions: Prisma.InputJsonValue | null | undefined
  ) {
    const options =
      rawOptions && typeof rawOptions === 'object' && !Array.isArray(rawOptions)
        ? { ...(rawOptions as Record<string, any>) }
        : {};
    if (type !== DatabaseFieldType.RELATION) {
      return options;
    }
    const relation = this.normalizeRelationOptions(options);
    if (!relation) {
      throw new Error('Relation target is required.');
    }
    const targetDatabase = await this.prisma.database.findUnique({
      where: { pageId: relation.pageId },
      select: { id: true, workspaceId: true, complianceMode: true },
    });
    if (!targetDatabase) {
      throw new Error('Relation target not found.');
    }
    if (targetDatabase.workspaceId !== database.workspaceId) {
      throw new Error('Relation target must be in the same workspace.');
    }
    if (database.complianceMode && !targetDatabase.complianceMode) {
      throw new Error('Relation target must be a compliant database.');
    }
    let history: { enabled: boolean; pageId?: string | null } | null = relation.history || null;
    if (history?.pageId) {
      const historyDatabase = await this.prisma.database.findUnique({
        where: { pageId: history.pageId },
        select: { workspaceId: true, complianceMode: true },
      });
      if (!historyDatabase) {
        throw new Error('Relation history database not found.');
      }
      if (historyDatabase.workspaceId !== database.workspaceId) {
        throw new Error('Relation history database must be in the same workspace.');
      }
      if (database.complianceMode && !historyDatabase.complianceMode) {
        throw new Error('Relation history database must be compliant.');
      }
    }
    const historyConfig = history?.enabled
      ? { enabled: true, ...(history?.pageId ? { pageId: history.pageId } : {}) }
      : null;
    return {
      ...options,
      relation: {
        pageId: relation.pageId,
        allowMultiple: relation.allowMultiple,
        ...(historyConfig ? { history: historyConfig } : {}),
      },
    };
  }

  private coerceDatabaseFieldValue(field: { type: DatabaseFieldType; options?: Prisma.JsonValue | null }, value: any) {
    if (value === null || value === undefined) return undefined;
    const options = this.normalizeDatabaseFieldOptions(field.options ?? null);
    switch (field.type) {
      case DatabaseFieldType.NUMBER: {
        if (typeof value === 'number') {
          return Number.isFinite(value) ? value : undefined;
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed) return undefined;
          const num = Number(trimmed);
          return Number.isFinite(num) ? num : undefined;
        }
        return undefined;
      }
      case DatabaseFieldType.CHECKBOX: {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
          const trimmed = value.trim().toLowerCase();
          if (!trimmed) return undefined;
          if (TRUE_STRINGS.has(trimmed)) return true;
          if (FALSE_STRINGS.has(trimmed)) return false;
          return true;
        }
        return undefined;
      }
      case DatabaseFieldType.DATE: {
        if (value instanceof Date) {
          return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
        }
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (!trimmed) return undefined;
          const parsed = Date.parse(trimmed);
          return Number.isNaN(parsed) ? undefined : trimmed;
        }
        return undefined;
      }
      case DatabaseFieldType.SELECT: {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (options.choiceValues && !options.choiceValues.includes(trimmed)) return undefined;
        return trimmed;
      }
      case DatabaseFieldType.MULTI_SELECT: {
        let values: string[] = [];
        if (Array.isArray(value)) {
          values = value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
        } else if (typeof value === 'string') {
          values = value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
        } else {
          return undefined;
        }
        if (options.choiceValues) {
          values = values.filter((item) => options.choiceValues?.includes(item));
        }
        if (!values.length) return undefined;
        return values;
      }
      case DatabaseFieldType.RELATION: {
        const relation = this.normalizeRelationOptions(field.options ?? null);
        if (!relation) return undefined;
        return this.coerceRelationValue(value, relation.allowMultiple);
      }
      case DatabaseFieldType.URL:
      case DatabaseFieldType.TEXT:
      default: {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          return trimmed ? trimmed : undefined;
        }
        if (typeof value === 'number') {
          return Number.isFinite(value) ? String(value) : undefined;
        }
        return undefined;
      }
    }
  }

  private buildComplianceSchema(
    fields: Array<{ id: string; name: string; type: DatabaseFieldType; options?: Prisma.JsonValue | null; position?: Prisma.Decimal }>
  ) {
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      fields: fields.map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: field.options ?? {},
        position: field.position?.toString?.() ?? null,
      })),
    };
  }

  private async ensureComplianceVersions(
    database: { id: string; workspaceId: string },
    fields: Array<{ id: string; name: string; type: DatabaseFieldType; options?: Prisma.JsonValue | null; position?: Prisma.Decimal }>,
    user?: { userId?: string; userName?: string }
  ) {
    let workflow = await this.compliance.getLatestWorkflowVersion(database.workspaceId, database.id);
    if (!workflow) {
      workflow = await this.compliance.createWorkflowVersion(
        { workspaceId: database.workspaceId, databaseId: database.id, config: this.DEFAULT_COMPLIANCE_WORKFLOW },
        user
      );
    }
    let schema = await this.compliance.getLatestSchemaVersion(database.workspaceId, database.id);
    if (!schema) {
      schema = await this.compliance.createSchemaVersion(
        { workspaceId: database.workspaceId, databaseId: database.id, schema: this.buildComplianceSchema(fields) },
        user
      );
    }
    return {
      workflowVersionId: workflow?.id || '',
      schemaVersionId: schema?.id || '',
    };
  }

  private async sanitizeDatabaseRowData(databaseId: string, rawData: Prisma.InputJsonValue) {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return {};
    const data = rawData as Record<string, any>;
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, type: true, options: true },
    });
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const relationTargetCache = new Map<string, { databaseId: string; titleFieldId: string | null } | null>();
    const resolveRelationTarget = async (pageId: string) => {
      if (relationTargetCache.has(pageId)) return relationTargetCache.get(pageId) || null;
      const targetDatabase = await this.prisma.database.findUnique({
        where: { pageId },
        select: { id: true },
      });
      if (!targetDatabase) {
        relationTargetCache.set(pageId, null);
        return null;
      }
      const titleFieldId = await this.resolveDatabaseTitleFieldId(targetDatabase.id);
      const target = { databaseId: targetDatabase.id, titleFieldId };
      relationTargetCache.set(pageId, target);
      return target;
    };
    const resolveRelationLabel = (
      rowData: Record<string, any> | null,
      titleFieldId: string | null,
      fallbackLabel: string,
      fallbackId: string
    ) => {
      let label = '';
      if (titleFieldId && rowData && typeof rowData === 'object' && !Array.isArray(rowData)) {
        const raw = rowData[titleFieldId];
        if (Array.isArray(raw)) {
          label = raw.map((item) => String(item ?? '')).filter(Boolean).join(', ');
        } else if (raw !== null && raw !== undefined) {
          label = String(raw);
        }
      }
      if (!label && fallbackLabel) label = fallbackLabel;
      if (!label && fallbackId) label = fallbackId;
      return label.trim();
    };
    const resolveRelationEntry = async (
      entry: { id: string; label: string },
      target: { databaseId: string; titleFieldId: string | null }
    ) => {
      const row = await this.prisma.databaseRow.findUnique({
        where: { id: entry.id },
        select: { id: true, databaseId: true, data: true },
      });
      if (!row || row.databaseId !== target.databaseId) return null;
      const rowData =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : null;
      const label = resolveRelationLabel(rowData, target.titleFieldId, entry.label, row.id);
      return { id: row.id, label };
    };
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '__pageId') {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (isUuid(trimmed)) {
          sanitized[key] = trimmed;
        }
        continue;
      }
      if (key === this.COMPLIANCE_RECORD_KEY) {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (isUuid(trimmed)) {
          sanitized[key] = trimmed;
        }
        continue;
      }
      const field = fieldMap.get(key);
      if (!field) continue;
      if (field.type === DatabaseFieldType.RELATION) {
        const relation = this.normalizeRelationOptions(field.options ?? null);
        if (!relation) continue;
        const target = await resolveRelationTarget(relation.pageId);
        if (!target) continue;
        const coerced = this.coerceRelationValue(value, relation.allowMultiple);
        if (coerced === undefined) continue;
        if (relation.allowMultiple) {
          const entries = Array.isArray(coerced) ? coerced : [];
          const resolved = await Promise.all(entries.map((entry) => resolveRelationEntry(entry, target)));
          const filtered = resolved.filter(Boolean);
          if (filtered.length) {
            sanitized[key] = filtered;
          }
        } else {
          const entry = Array.isArray(coerced) ? null : coerced;
          if (entry) {
            const resolved = await resolveRelationEntry(entry, target);
            if (resolved) {
              sanitized[key] = resolved;
            }
          }
        }
        continue;
      }
      const next = this.coerceDatabaseFieldValue(field, value);
      if (next !== undefined) {
        sanitized[key] = next;
      }
    }
    return sanitized;
  }

  private normalizeDatabaseFormStorage(raw: Prisma.InputJsonValue) {
    if (Array.isArray(raw)) {
      return { fields: raw, config: null };
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const fields = Array.isArray((raw as any).fields) ? (raw as any).fields : [];
      const config =
        (raw as any).config && typeof (raw as any).config === 'object' && !Array.isArray((raw as any).config)
          ? (raw as any).config
          : null;
      return { fields, config };
    }
    return { fields: [], config: null };
  }

  private async sanitizeDatabaseFormFields(databaseId: string, rawFields: Prisma.InputJsonValue) {
    const rawList = Array.isArray(rawFields)
      ? rawFields
      : rawFields && typeof rawFields === 'object' && !Array.isArray(rawFields)
        ? (rawFields as any).fields
        : null;
    if (!Array.isArray(rawList)) return [];
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, type: true, options: true },
    });
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const allowed = new Set(fields.map((field) => field.id));
    const seen = new Set<string>();
    const normalized: Array<{
      fieldId: string;
      label: string | null;
      required: boolean;
      editable: boolean;
      auto?: any;
      selectSource?: { type: string; relationFieldId: string; targetFieldId: string };
      requiredWhen?: { fieldId: string; op: string; value?: any };
      visibleWhen?: { fieldId: string; op: string; value?: any };
    }> = [];
    const relationTargetCache = new Map<string, Set<string> | null>();
    const resolveRelationTargetFields = async (pageId: string) => {
      if (relationTargetCache.has(pageId)) return relationTargetCache.get(pageId) || null;
      const targetDatabase = await this.prisma.database.findUnique({
        where: { pageId },
        select: { id: true },
      });
      if (!targetDatabase?.id) {
        relationTargetCache.set(pageId, null);
        return null;
      }
      const targetFields = await this.prisma.databaseField.findMany({
        where: { databaseId: targetDatabase.id },
        select: { id: true },
      });
      const fieldIds = new Set(targetFields.map((field) => field.id));
      relationTargetCache.set(pageId, fieldIds);
      return fieldIds;
    };
    const normalizeAuto = (
      raw: unknown,
      fieldId: string,
      selectSource?: { type: string } | null
    ) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const type = typeof (raw as any).type === 'string' ? (raw as any).type.trim() : '';
      if (type === 'template') {
        const template = typeof (raw as any).template === 'string' ? (raw as any).template.trim() : '';
        return template ? { type, template } : null;
      }
      if (type === 'currentUser') {
        const mode = typeof (raw as any).mode === 'string' ? (raw as any).mode.trim() : '';
        if (mode === 'id' || mode === 'name') {
          return { type, mode };
        }
        return { type };
      }
      if (type === 'fixed') {
        const value = typeof (raw as any).value === 'string' ? (raw as any).value.trim() : '';
        if (!value) return null;
        const field = fieldMap.get(fieldId);
        if (!field || (field.type !== DatabaseFieldType.SELECT && field.type !== DatabaseFieldType.RELATION)) {
          return null;
        }
        if (field.type === DatabaseFieldType.RELATION) {
          return isUuid(value) ? { type, value } : null;
        }
        if (selectSource?.type === 'relation') return { type, value };
        const choices = this.normalizeDatabaseFieldOptions(field.options ?? null).choiceValues;
        if (!choices || !choices.includes(value)) return null;
        return { type, value };
      }
      return null;
    };
    const normalizeSelectSource = async (raw: unknown, fieldId: string) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const type = typeof (raw as any).type === 'string' ? (raw as any).type.trim() : '';
      if (type !== 'relation') return null;
      const relationFieldId =
        typeof (raw as any).relationFieldId === 'string' ? (raw as any).relationFieldId.trim() : '';
      const targetFieldId = typeof (raw as any).targetFieldId === 'string' ? (raw as any).targetFieldId.trim() : '';
      if (!relationFieldId || !targetFieldId) return null;
      const field = fieldMap.get(fieldId);
      if (!field || field.type !== DatabaseFieldType.SELECT) return null;
      const relationField = fieldMap.get(relationFieldId);
      if (!relationField || relationField.type !== DatabaseFieldType.RELATION) return null;
      const relation = this.normalizeRelationOptions(relationField.options ?? null);
      if (!relation?.pageId) return null;
      const targetFieldIds = await resolveRelationTargetFields(relation.pageId);
      if (!targetFieldIds || !targetFieldIds.has(targetFieldId)) return null;
      return { type, relationFieldId, targetFieldId };
    };
    const normalizeRequiredWhen = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const rawFieldId = typeof (raw as any).fieldId === 'string' ? (raw as any).fieldId.trim() : '';
      if (!rawFieldId || !allowed.has(rawFieldId)) return null;
      const op = typeof (raw as any).op === 'string' ? (raw as any).op.trim() : 'equals';
      if (op === 'isFilled' || op === 'isEmpty') {
        const field = fieldMap.get(rawFieldId);
        if (!field) return null;
        return { fieldId: rawFieldId, op };
      }
      if (op !== 'equals') return null;
      const field = fieldMap.get(rawFieldId);
      if (!field || field.type !== DatabaseFieldType.SELECT) return null;
      const value = this.coerceDatabaseFieldValue(field, (raw as any).value);
      if (typeof value !== 'string') return null;
      return { fieldId: rawFieldId, op, value };
    };
    const normalizeVisibleWhen = (raw: unknown) => normalizeRequiredWhen(raw);
    for (const entry of rawList) {
      let fieldId = '';
      let label: string | null = null;
      let required = false;
      let editable = true;
      let auto: { type: string; template?: string; mode?: string } | null = null;
      let selectSource: { type: string; relationFieldId: string; targetFieldId: string } | null = null;
      let requiredWhen: { fieldId: string; op: string; value?: any } | null = null;
      let visibleWhen: { fieldId: string; op: string; value?: any } | null = null;
      if (typeof entry === 'string') {
        fieldId = entry.trim();
      } else if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const rawFieldId = (entry as any).fieldId ?? (entry as any).id;
        if (typeof rawFieldId === 'string') {
          fieldId = rawFieldId.trim();
        }
        if (typeof (entry as any).label === 'string') {
          const nextLabel = (entry as any).label.trim();
          label = nextLabel ? nextLabel : null;
        }
        if (typeof (entry as any).required === 'boolean') {
          required = (entry as any).required;
        }
        if (typeof (entry as any).editable === 'boolean') {
          editable = (entry as any).editable;
        }
        selectSource = await normalizeSelectSource((entry as any).selectSource, fieldId);
        auto = normalizeAuto((entry as any).auto, fieldId, selectSource);
        requiredWhen = normalizeRequiredWhen((entry as any).requiredWhen);
        visibleWhen = normalizeVisibleWhen((entry as any).visibleWhen);
      }
      if (!fieldId || !allowed.has(fieldId) || seen.has(fieldId)) {
        continue;
      }
      seen.add(fieldId);
      if (auto) {
        const base = { fieldId, label, required, editable, auto };
        const withSource = selectSource ? { ...base, selectSource } : base;
        const withRequired = requiredWhen ? { ...withSource, requiredWhen } : withSource;
        normalized.push(visibleWhen ? { ...withRequired, visibleWhen } : withRequired);
      } else {
        const base = { fieldId, label, required, editable };
        const withSource = selectSource ? { ...base, selectSource } : base;
        const withRequired = requiredWhen ? { ...withSource, requiredWhen } : withSource;
        normalized.push(visibleWhen ? { ...withRequired, visibleWhen } : withRequired);
      }
    }
    return normalized;
  }

  private async sanitizeDatabaseFormConfig(
    databaseId: string,
    rawConfig: unknown,
    options: { complianceMode?: boolean } = {}
  ) {
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return null;
    const mode = (rawConfig as any).mode === 'update' ? 'update' : 'create';
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true, type: true, options: true },
    });
    const fieldMap = new Map(fields.map((field) => [field.id, field]));
    const complianceMode = options.complianceMode === true;
    let filter: any = null;
    const rawFilter = (rawConfig as any).filter;
    if (rawFilter && typeof rawFilter === 'object' && !Array.isArray(rawFilter)) {
      const fieldId = typeof rawFilter.fieldId === 'string' ? rawFilter.fieldId.trim() : '';
      const op = typeof rawFilter.op === 'string' ? rawFilter.op.trim() : '';
      if (complianceMode && fieldId === this.GOVERNANCE_FILTER_FIELD_ID && ['isEmpty', 'isNotEmpty', 'equals', 'notEquals'].includes(op)) {
        if (op === 'equals' || op === 'notEquals') {
          const rawValue = Object.prototype.hasOwnProperty.call(rawFilter as any, 'value')
            ? (rawFilter as any).value
            : '';
          const normalized =
            typeof rawValue === 'string'
              ? rawValue.trim().toUpperCase()
              : rawValue === null || rawValue === undefined
              ? ''
              : String(rawValue).trim().toUpperCase();
          filter = { fieldId, op, value: normalized };
        } else {
          filter = { fieldId, op };
        }
      }
      const field = fieldMap.get(fieldId);
      if (!filter && field && ['isEmpty', 'isNotEmpty', 'equals', 'notEquals'].includes(op)) {
        if (op === 'equals' || op === 'notEquals') {
          const rawValue = Object.prototype.hasOwnProperty.call(rawFilter as any, 'value')
            ? (rawFilter as any).value
            : '';
          const coerced = this.coerceDatabaseFieldValue(field, rawValue);
          if (coerced !== undefined) {
            filter = { fieldId, op, value: coerced };
          } else {
            let fallback: any = '';
            if (Array.isArray(rawValue)) {
              const cleaned = rawValue
                .map((item) => String(item ?? '').trim())
                .filter((item) => item);
              fallback = cleaned.length ? cleaned : '';
            } else if (rawValue === null || rawValue === undefined) {
              fallback = '';
            } else if (typeof rawValue === 'string') {
              fallback = rawValue.trim();
            } else {
              fallback = String(rawValue);
            }
            filter = { fieldId, op, value: fallback };
          }
        } else {
          filter = { fieldId, op };
        }
      }
    }
    const rawMessage = typeof (rawConfig as any).successMessage === 'string' ? (rawConfig as any).successMessage.trim() : '';
    const successMessage = rawMessage || '';
    const showReturnButton = (rawConfig as any).showReturnButton === true;
    let initialStatus: string | null = null;
    if (complianceMode) {
      const rawStatus = typeof (rawConfig as any).initialStatus === 'string' ? (rawConfig as any).initialStatus.trim() : '';
      const normalized = rawStatus.toUpperCase();
      const allowed = new Set(['DRAFT', 'SUBMITTED', 'REVIEW', 'CLOSED', 'ARCHIVED']);
      initialStatus = allowed.has(normalized) ? normalized : 'SUBMITTED';
    }
    let transitionStatus: string | null = null;
    if (complianceMode && mode === 'update') {
      const rawStatus =
        typeof (rawConfig as any).transitionStatus === 'string' ? (rawConfig as any).transitionStatus.trim() : '';
      const normalized = rawStatus.toUpperCase();
      const allowed = new Set(['DRAFT', 'SUBMITTED', 'REVIEW', 'CLOSED', 'ARCHIVED']);
      transitionStatus = allowed.has(normalized) ? normalized : null;
    }
    return {
      mode,
      ...(filter ? { filter } : {}),
      ...(successMessage ? { successMessage } : {}),
      showReturnButton,
      ...(initialStatus ? { initialStatus } : {}),
      ...(transitionStatus ? { transitionStatus } : {}),
    };
  }

  async getDatabase(pageId: string, user?: { userId?: string; userName?: string }) {
    // Include the database page's current title: inline views only store a copy from when
    // they were inserted, so exports would otherwise show a stale name
    const page = await this.prisma.page.findUnique({ where: { id: pageId }, select: { title: true } });
    const database = { ...(await this.getDatabaseForPage(pageId, user)), title: page?.title ?? '' };
    if (!database.complianceMode || !database.rows?.length) {
      return database;
    }
    const recordIds = new Set<string>();
    const recordIdByRowId = new Map<string, string>();
    database.rows.forEach((row) => {
      const data =
        row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? (row.data as Record<string, any>)
          : null;
      if (!data) return;
      const rawRecordId = data[this.COMPLIANCE_RECORD_KEY];
      const recordId = typeof rawRecordId === 'string' ? rawRecordId.trim() : '';
      if (!isUuid(recordId)) return;
      recordIds.add(recordId);
      if (row?.id) {
        recordIdByRowId.set(row.id, recordId);
      }
    });
    if (!recordIds.size) {
      return database;
    }
    const statusMap = await this.compliance.getRecordStatuses([...recordIds], user, {
      workspaceId: database.workspaceId,
      databaseId: database.id,
    });
    database.rows = database.rows.map((row) => {
      const recordId = row?.id ? recordIdByRowId.get(row.id) : null;
      const status = recordId ? statusMap.get(recordId) ?? null : null;
      return { ...row, complianceStatus: status };
    });
    return database;
  }

  async getDatabaseRowBacklinks(rowId: string, user?: { userId?: string; userName?: string }) {
    const targetId = typeof rowId === 'string' ? rowId.trim() : '';
    if (!targetId || !isUuid(targetId)) {
      throw new Error('Row not found');
    }
    const row = await this.prisma.databaseRow.findUnique({
      where: { id: targetId },
      select: { id: true, databaseId: true },
    });
    if (!row) {
      throw new Error('Row not found');
    }
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { id: true, pageId: true, workspaceId: true },
    });
    if (!database) {
      throw new Error('Database not found');
    }
    const { membership } = await this.requirePageAccess(database.pageId, user);
    const userId = user?.userId || '';

    const relationFields = await this.prisma.databaseField.findMany({
      where: {
        type: DatabaseFieldType.RELATION,
        database: { workspaceId: database.workspaceId },
      },
      select: { id: true, name: true, databaseId: true, options: true },
    });
    const matchingFields = relationFields
      .map((field) => {
        const relation = this.normalizeRelationOptions(field.options ?? null);
        if (!relation || relation.pageId !== database.pageId) return null;
        return { id: field.id, name: field.name, databaseId: field.databaseId };
      })
      .filter(Boolean) as Array<{ id: string; name: string; databaseId: string }>;

    if (!matchingFields.length) {
      return { rowId: row.id, backlinks: [] };
    }

    const sourceDatabaseIds = [...new Set(matchingFields.map((field) => field.databaseId))];
    const sourceDatabases = await this.prisma.database.findMany({
      where: { id: { in: sourceDatabaseIds } },
      select: { id: true, pageId: true },
    });
    const sourceDatabaseById = new Map(sourceDatabases.map((db) => [db.id, db]));
    const sourcePageIds = sourceDatabases.map((db) => db.pageId);
    const sourcePages = await this.prisma.page.findMany({
      where: { id: { in: sourcePageIds }, isDeleted: false },
      select: { id: true, title: true, visibility: true, authorId: true, isHidden: true },
    });
    const pageById = new Map(sourcePages.map((page) => [page.id, page]));

    const canSeePrivate = membership.role !== WorkspaceRole.VIEWER;
    const allowedPageIds = new Set(
      sourcePages
        .filter((page) => {
          if (page.isHidden) return false;
          if (page.visibility === PageVisibility.PUBLIC) return true;
          return canSeePrivate && page.authorId === userId;
        })
        .map((page) => page.id)
    );
    const allowedDatabaseIds = new Set(
      sourceDatabases.filter((db) => allowedPageIds.has(db.pageId)).map((db) => db.id)
    );
    if (!allowedDatabaseIds.size) {
      return { rowId: row.id, backlinks: [] };
    }

    const fieldsByDatabase = new Map<string, Array<{ id: string; name: string }>>();
    matchingFields.forEach((field) => {
      if (!allowedDatabaseIds.has(field.databaseId)) return;
      const list = fieldsByDatabase.get(field.databaseId) || [];
      list.push({ id: field.id, name: field.name });
      fieldsByDatabase.set(field.databaseId, list);
    });
    if (!fieldsByDatabase.size) {
      return { rowId: row.id, backlinks: [] };
    }

    const rows = await this.prisma.databaseRow.findMany({
      where: { databaseId: { in: [...fieldsByDatabase.keys()] } },
      select: { id: true, pageId: true, databaseId: true, data: true },
    });
    const titleFieldByDatabase = new Map<string, string | null>();
    await Promise.all(
      [...fieldsByDatabase.keys()].map(async (databaseId) => {
        const titleFieldId = await this.resolveDatabaseTitleFieldId(databaseId);
        titleFieldByDatabase.set(databaseId, titleFieldId);
      })
    );

    const backlinks: Array<{
      databaseId: string;
      databasePageId: string;
      databaseTitle: string;
      fieldId: string;
      fieldName: string;
      rowId: string;
      rowPageId: string | null;
      rowTitle: string;
    }> = [];

    rows.forEach((sourceRow) => {
      const data =
        sourceRow.data && typeof sourceRow.data === 'object' && !Array.isArray(sourceRow.data)
          ? (sourceRow.data as Record<string, any>)
          : null;
      if (!data) return;
      const fields = fieldsByDatabase.get(sourceRow.databaseId);
      if (!fields?.length) return;
      const titleFieldId = titleFieldByDatabase.get(sourceRow.databaseId) || null;
      const rowTitle = this.resolveTitleFromData(data, titleFieldId, sourceRow.id);
      const sourceDatabase = sourceDatabaseById.get(sourceRow.databaseId);
      const pageId = sourceDatabase?.pageId || '';
      const page = pageById.get(pageId);
      const databaseTitle = page?.title?.trim() || 'Database';

      fields.forEach((field) => {
        const entries = this.collectRelationEntries(data[field.id]);
        if (!entries.some((entry) => entry.id === targetId)) return;
        backlinks.push({
          databaseId: sourceRow.databaseId,
          databasePageId: pageId,
          databaseTitle,
          fieldId: field.id,
          fieldName: field.name,
          rowId: sourceRow.id,
          rowPageId: sourceRow.pageId ?? null,
          rowTitle,
        });
      });
    });

    backlinks.sort((a, b) => {
      const dbCompare = a.databaseTitle.localeCompare(b.databaseTitle);
      if (dbCompare !== 0) return dbCompare;
      const fieldCompare = a.fieldName.localeCompare(b.fieldName);
      if (fieldCompare !== 0) return fieldCompare;
      return a.rowTitle.localeCompare(b.rowTitle);
    });

    return { rowId: row.id, backlinks };
  }

  async updateDatabaseSettings(
    pageId: string,
    payload: { complianceMode?: boolean },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    if (typeof payload.complianceMode !== 'boolean') {
      return database;
    }
    return this.prisma.database.update({
      where: { id: database.id },
      data: { complianceMode: payload.complianceMode },
    });
  }

  async createDatabaseForm(
    pageId: string,
    payload: {
      name?: string;
      icon?: string;
      fields?: Prisma.InputJsonValue;
      config?: Prisma.InputJsonValue;
      position?: Prisma.Decimal;
    },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const name = rawName || 'Form';
    const icon = this.normalizeFormIcon(payload.icon) || this.DEFAULT_FORM_ICON;
    const position = payload.position ?? (await this.nextDatabaseFormPosition(database.id));
    const fields = payload.fields ? await this.sanitizeDatabaseFormFields(database.id, payload.fields) : [];
    const config = payload.config
      ? await this.sanitizeDatabaseFormConfig(database.id, payload.config, { complianceMode: database.complianceMode })
      : null;
    const storage = config ? { fields, config } : fields;
    return this.prisma.databaseForm.create({
      data: {
        databaseId: database.id,
        name,
        icon,
        fields: storage,
        position,
      },
    });
  }

  async updateDatabaseForm(
    id: string,
    payload: {
      name?: string;
      icon?: string;
      fields?: Prisma.InputJsonValue;
      config?: Prisma.InputJsonValue;
      position?: Prisma.Decimal;
    },
    user?: { userId?: string; userName?: string }
  ) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, databaseId: true, fields: true },
    });
    if (!form) throw new Error('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { pageId: true, complianceMode: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const updateData: Prisma.DatabaseFormUpdateInput = {};
    if (typeof payload.name === 'string') {
      updateData.name = payload.name.trim() || 'Form';
    }
    if (payload.icon !== undefined) {
      updateData.icon = this.normalizeFormIcon(payload.icon) || this.DEFAULT_FORM_ICON;
    }
    if (payload.position !== undefined) {
      updateData.position = payload.position;
    }
    if (payload.fields !== undefined || payload.config !== undefined) {
      const existing = this.normalizeDatabaseFormStorage(form.fields ?? []);
      const nextFields =
        payload.fields !== undefined
          ? await this.sanitizeDatabaseFormFields(form.databaseId, payload.fields)
          : await this.sanitizeDatabaseFormFields(form.databaseId, existing.fields);
      const nextConfig =
        payload.config !== undefined
          ? await this.sanitizeDatabaseFormConfig(form.databaseId, payload.config, { complianceMode: database.complianceMode })
          : existing.config
          ? await this.sanitizeDatabaseFormConfig(form.databaseId, existing.config, { complianceMode: database.complianceMode })
          : null;
      updateData.fields = nextConfig ? { fields: nextFields, config: nextConfig } : nextFields;
    }
    return this.prisma.databaseForm.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteDatabaseForm(id: string, user?: { userId?: string; userName?: string }) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!form) throw new Error('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    return this.prisma.databaseForm.delete({ where: { id: form.id } });
  }

  private readonly DEFAULT_VIEW_ICON = 'icon:table';
  private readonly VIEW_TYPES = ['TABLE', 'GALLERY', 'BOARD'];
  private readonly VIEW_FILTER_OPERATORS = [
    'is',
    'is_not',
    'contains',
    'not_contains',
    'is_empty',
    'is_not_empty',
    'gt',
    'gte',
    'lt',
    'lte',
    'before',
    'after',
    'on_or_before',
    'on_or_after',
    'is_checked',
    'is_unchecked',
  ];

  private normalizeViewType(value: unknown) {
    const upper = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return this.VIEW_TYPES.includes(upper) ? upper : 'TABLE';
  }

  private async nextDatabaseViewPosition(databaseId: string) {
    const last = await this.prisma.databaseView.findFirst({
      where: { databaseId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return last?.position ? last.position.plus(this.POSITION_INCREMENT) : this.POSITION_INCREMENT;
  }

  private async sanitizeDatabaseViewConfig(databaseId: string, config: unknown) {
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId },
      select: { id: true },
    });
    const fieldIds = new Set(fields.map((f) => f.id));
    const source = config && typeof config === 'object' && !Array.isArray(config) ? (config as Record<string, any>) : {};

    const rawFilters = source.filters && typeof source.filters === 'object' ? source.filters : {};
    const match = rawFilters.match === 'OR' ? 'OR' : 'AND';
    const rules = Array.isArray(rawFilters.rules)
      ? rawFilters.rules
          .filter((rule: any) => rule && typeof rule === 'object' && fieldIds.has(rule.fieldId))
          .filter((rule: any) => this.VIEW_FILTER_OPERATORS.includes(rule.operator))
          .map((rule: any) => ({
            fieldId: rule.fieldId as string,
            operator: rule.operator as string,
            // Value is arbitrary JSON (string/number/boolean/array); default to null.
            value: rule.value === undefined ? null : rule.value,
          }))
          .slice(0, 50)
      : [];

    const sorts = Array.isArray(source.sorts)
      ? source.sorts
          .filter((sort: any) => sort && typeof sort === 'object' && fieldIds.has(sort.fieldId))
          .map((sort: any) => ({
            fieldId: sort.fieldId as string,
            direction: sort.direction === 'desc' ? 'desc' : 'asc',
          }))
          .slice(0, 20)
      : [];

    const hiddenFieldIds = Array.isArray(source.hiddenFieldIds)
      ? source.hiddenFieldIds.filter((id: any) => typeof id === 'string' && fieldIds.has(id))
      : [];

    const groupFieldId = fieldIds.has(source.groupFieldId) ? (source.groupFieldId as string) : null;
    const cardFieldId = fieldIds.has(source.cardFieldId) ? (source.cardFieldId as string) : null;

    return {
      filters: { match, rules },
      sorts,
      hiddenFieldIds,
      groupFieldId,
      cardFieldId,
    };
  }

  async createDatabaseView(
    pageId: string,
    payload: { name?: string; type?: string; icon?: string; config?: unknown; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const name = rawName || 'View';
    const type = this.normalizeViewType(payload.type);
    const icon = this.normalizeFormIcon(payload.icon) || this.DEFAULT_VIEW_ICON;
    const position = payload.position ?? (await this.nextDatabaseViewPosition(database.id));
    const config = await this.sanitizeDatabaseViewConfig(database.id, payload.config);
    return this.prisma.databaseView.create({
      data: {
        databaseId: database.id,
        name,
        type,
        icon,
        config,
        position,
      },
    });
  }

  async updateDatabaseView(
    id: string,
    payload: { name?: string; type?: string; icon?: string; config?: unknown; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const view = await this.prisma.databaseView.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!view) throw new Error('View not found');
    const database = await this.prisma.database.findUnique({
      where: { id: view.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const updateData: Prisma.DatabaseViewUpdateInput = {};
    if (typeof payload.name === 'string') {
      updateData.name = payload.name.trim() || 'View';
    }
    if (payload.type !== undefined) {
      updateData.type = this.normalizeViewType(payload.type);
    }
    if (payload.icon !== undefined) {
      updateData.icon = this.normalizeFormIcon(payload.icon) || this.DEFAULT_VIEW_ICON;
    }
    if (payload.position !== undefined) {
      updateData.position = payload.position;
    }
    if (payload.config !== undefined) {
      updateData.config = await this.sanitizeDatabaseViewConfig(view.databaseId, payload.config);
    }
    return this.prisma.databaseView.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteDatabaseView(id: string, user?: { userId?: string; userName?: string }) {
    const view = await this.prisma.databaseView.findUnique({
      where: { id },
      select: { id: true, databaseId: true },
    });
    if (!view) throw new Error('View not found');
    const database = await this.prisma.database.findUnique({
      where: { id: view.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    return this.prisma.databaseView.delete({ where: { id: view.id } });
  }

  async getDatabaseForm(id: string, user?: { userId?: string; userName?: string }) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, name: true, icon: true, fields: true, databaseId: true },
    });
    if (!form) throw new Error('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { id: true, pageId: true, complianceMode: true, fields: { orderBy: { position: 'asc' } } },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user);
    const storage = this.normalizeDatabaseFormStorage(form.fields ?? []);
    const fields = await this.sanitizeDatabaseFormFields(form.databaseId, storage.fields);
    const config = storage.config
      ? await this.sanitizeDatabaseFormConfig(form.databaseId, storage.config, { complianceMode: database.complianceMode })
      : null;
    const rowCount = await this.prisma.databaseRow.count({ where: { databaseId: database.id } });
    return {
      id: form.id,
      name: form.name,
      icon: form.icon || this.DEFAULT_FORM_ICON,
      fields,
      ...(config ? { config } : {}),
      databaseId: database.id,
      databasePageId: database.pageId,
      databaseComplianceMode: database.complianceMode,
      databaseFields: database.fields,
      databaseRowCount: rowCount,
    };
  }

  async submitDatabaseForm(
    id: string,
    payload: { data?: Prisma.InputJsonValue; rowId?: string; reason?: string },
    user?: { userId?: string; userName?: string }
  ) {
    const form = await this.prisma.databaseForm.findUnique({
      where: { id },
      select: { id: true, fields: true, databaseId: true },
    });
    if (!form) throw new Error('Form not found');
    const database = await this.prisma.database.findUnique({
      where: { id: form.databaseId },
      select: { id: true, pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const storage = this.normalizeDatabaseFormStorage(form.fields ?? []);
    const allowedFields = await this.sanitizeDatabaseFormFields(form.databaseId, storage.fields);
    const config = storage.config
      ? await this.sanitizeDatabaseFormConfig(form.databaseId, storage.config, { complianceMode: database.complianceMode })
      : null;
    const databaseFields = await this.prisma.databaseField.findMany({
      where: { databaseId: form.databaseId },
      select: { id: true, name: true, type: true, options: true },
    });
    const fieldMap = new Map(databaseFields.map((field) => [field.id, field]));
    const rowCount = await this.prisma.databaseRow.count({ where: { databaseId: form.databaseId } });
    const editableSet = new Set(
      allowedFields.filter((entry: any) => entry?.editable !== false).map((entry: any) => entry.fieldId)
    );
    const allowedSet = new Set(allowedFields.map((entry: any) => entry.fieldId));
    const rawData =
      payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, any>)
        : {};
    const filtered: Record<string, any> = {};
    Object.entries(rawData).forEach(([key, value]) => {
      if (allowedSet.has(key) && editableSet.has(key)) {
        filtered[key] = value;
      }
    });
    const userId = user?.userId || '';
    const userName = user?.userName || userId || '';
    const nextCounter = rowCount + 1;
    const resolveTemplate = (template: string) => {
      const replacements: Record<string, string> = {
        counter: String(nextCounter),
        user: userName || '',
        userId: userId || '',
        date: new Date().toISOString().slice(0, 10),
        datetime: new Date().toISOString(),
      };
      return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        const token = String(key || '').trim();
        if (token in replacements) return replacements[token] || '';
        return '';
      });
    };
    const resolveAutoValue = (auto: any, field: any) => {
      if (!auto || !field) return undefined;
      if (auto.type === 'currentUser') {
        const source = this.getFieldSource(field.options);
        const mode = auto.mode === 'id' || auto.mode === 'name' ? auto.mode : source === 'members' ? 'id' : 'name';
        const value = mode === 'id' ? userId : userName;
        if (!value) return undefined;
        if (field.type === DatabaseFieldType.MULTI_SELECT) {
          return [value];
        }
        return value;
      }
      if (auto.type === 'fixed') {
        const value = typeof auto.value === 'string' ? auto.value.trim() : '';
        if (!value) return undefined;
        if (field.type === DatabaseFieldType.SELECT) {
          return value;
        }
        if (field.type === DatabaseFieldType.RELATION) {
          return isUuid(value) ? value : undefined;
        }
        return undefined;
      }
      if (auto.type === 'template' && typeof auto.template === 'string') {
        const rendered = resolveTemplate(auto.template);
        if (!rendered) return undefined;
        if (field.type === DatabaseFieldType.NUMBER) {
          const num = Number(rendered);
          return Number.isFinite(num) ? num : undefined;
        }
        return rendered;
      }
      return undefined;
    };
    const autoData: Record<string, any> = {};
    allowedFields.forEach((entry: any) => {
      const auto = entry?.auto;
      if (!auto) return;
      const field = fieldMap.get(entry.fieldId);
      const value = resolveAutoValue(auto, field);
      if (value !== undefined) {
        autoData[entry.fieldId] = value;
      }
    });
    const merged = { ...filtered, ...autoData };
    const allowedFieldMap = new Map(allowedFields.map((entry: any) => [entry.fieldId, entry]));
    const sanitized: Record<string, any> = {};
    Object.entries(merged).forEach(([key, value]) => {
      const field = fieldMap.get(key);
      if (!field) return;
      const entry = allowedFieldMap.get(key);
      const selectSource =
        entry?.selectSource && typeof entry.selectSource === 'object' && !Array.isArray(entry.selectSource)
          ? entry.selectSource
          : null;
      const hasRelationSelectSource =
        selectSource?.type === 'relation' &&
        typeof selectSource.relationFieldId === 'string' &&
        selectSource.relationFieldId.trim() &&
        typeof selectSource.targetFieldId === 'string' &&
        selectSource.targetFieldId.trim();
      let next;
      if (field.type === DatabaseFieldType.SELECT && hasRelationSelectSource) {
        if (value === null || value === undefined) return;
        const trimmed = typeof value === 'string' ? value.trim() : String(value).trim();
        if (!trimmed) return;
        next = trimmed;
      } else {
        next = this.coerceDatabaseFieldValue(field, value);
      }
      if (next !== undefined) {
        sanitized[key] = next;
      }
    });
    const isUpdateMode = config?.mode === 'update';
    const transitionStatus =
      typeof config?.transitionStatus === 'string' ? config.transitionStatus.trim().toUpperCase() : '';
    let existingRow: { id: string; databaseId: string; data: Prisma.InputJsonValue | null } | null = null;
    let existingData: Record<string, any> | null = null;
    if (isUpdateMode) {
      const rowId = typeof payload?.rowId === 'string' ? payload.rowId.trim() : '';
      if (!rowId) throw new Error('rowId is required');
      existingRow = await this.prisma.databaseRow.findUnique({
        where: { id: rowId },
        select: { id: true, databaseId: true, data: true },
      });
      if (!existingRow || existingRow.databaseId !== form.databaseId) throw new Error('Row not found');
      existingData =
        existingRow.data && typeof existingRow.data === 'object' && !Array.isArray(existingRow.data)
          ? { ...(existingRow.data as Record<string, any>) }
          : {};
    }
    const candidateData = existingData ? { ...existingData, ...sanitized } : sanitized;
    const isMissingRequiredValue = (field: any, value: any) => {
      if (field.type === DatabaseFieldType.RELATION) {
        if (Array.isArray(value)) {
          return !value.some((entry) => entry && isUuid(entry.id));
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return !isUuid(typeof value.id === 'string' ? value.id : '');
        }
        if (typeof value === 'string') {
          return !isUuid(value.trim());
        }
        return true;
      }
      if (field.type === DatabaseFieldType.MULTI_SELECT) {
        return !Array.isArray(value) || value.length === 0;
      }
      if (field.type === DatabaseFieldType.CHECKBOX) {
        return value !== true;
      }
      if (field.type === DatabaseFieldType.NUMBER) {
        return value === undefined || value === null || String(value).trim() === '';
      }
      return value === undefined || value === null || String(value).trim() === '';
    };
    const isConditionMet = (condition: any) => {
      if (!condition || typeof condition !== 'object') return false;
      const fieldId = typeof condition.fieldId === 'string' ? condition.fieldId.trim() : '';
      if (!fieldId) return false;
      const field = fieldMap.get(fieldId);
      if (!field) return false;
      const op = typeof condition.op === 'string' ? condition.op.trim() : 'equals';
      if (op === 'isFilled' || op === 'isEmpty') {
        const value = candidateData[fieldId];
        const missing = isMissingRequiredValue(field, value);
        return op === 'isEmpty' ? missing : !missing;
      }
      if (op !== 'equals') return false;
      const expected = typeof condition.value === 'string' ? condition.value.trim() : '';
      if (!expected) return false;
      const value = candidateData[fieldId];
      return String(value ?? '').trim() === expected;
    };
    const missingRequired = allowedFields
      .map((entry: any) => {
        if (entry?.editable === false && !entry?.auto) return null;
        const field = fieldMap.get(entry.fieldId);
        if (!field) return null;
        if (this.getFieldSource(field.options) === 'assetTag') return null;
        const isVisible = entry?.visibleWhen ? isConditionMet(entry.visibleWhen) : true;
        if (!isVisible) return null;
        const conditionMet = entry?.requiredWhen ? isConditionMet(entry.requiredWhen) : false;
        if (!entry?.required && !conditionMet) return null;
        const hasValue = Object.prototype.hasOwnProperty.call(sanitized, entry.fieldId);
        const value = entry?.required ? (hasValue ? sanitized[entry.fieldId] : undefined) : candidateData[entry.fieldId];
        if (isMissingRequiredValue(field, value)) {
          const label =
            typeof entry.label === 'string' && entry.label.trim() ? entry.label.trim() : field.name || 'Field';
          return label;
        }
        return null;
      })
      .filter(Boolean) as string[];
    if (missingRequired.length) {
      throw new Error(`Missing required fields: ${missingRequired.join(', ')}`);
    }
    const assetTagFieldIds = this.getAssetTagFieldIds(databaseFields);
    const rowIdForCreate = !isUpdateMode && assetTagFieldIds.length ? randomUUID() : null;
    const sanitizedWithAssetTags = rowIdForCreate
      ? this.applyAssetTagValues(sanitized, assetTagFieldIds, rowIdForCreate)
      : sanitized;
    if (database.complianceMode) {
      const { workflowVersionId, schemaVersionId } = await this.ensureComplianceVersions(database, databaseFields, user);
      if (!workflowVersionId || !schemaVersionId) {
        throw new Error('Compliance workflow or schema is not configured.');
      }
      if (isUpdateMode) {
        const row = existingRow;
        if (!row) throw new Error('Row not found');
        const existing = existingData || {};
        const recordId =
          typeof existing[this.COMPLIANCE_RECORD_KEY] === 'string' ? (existing[this.COMPLIANCE_RECORD_KEY] as string) : '';
        if (!isUuid(recordId)) {
          throw new Error('Compliance record ID is missing for this row.');
        }
        const reason = typeof payload?.reason === 'string' ? payload.reason.trim() : '';
        if (!reason) {
          throw new Error('Reason is required for compliance amendments.');
        }
        const dataForAmend = assetTagFieldIds.length
          ? this.applyAssetTagValuesFromExisting(sanitized, assetTagFieldIds, existing, row.id)
          : sanitized;
        await this.compliance.amendRecord(recordId, { data: dataForAmend, reason, schemaVersionId }, user);
        const mergedData = { ...existing, ...sanitized, [this.COMPLIANCE_RECORD_KEY]: recordId };
        const updated = await this.updateDatabaseRow(row.id, { data: mergedData }, user);
        let complianceStatus: string | null = null;
        let transitionError = '';
        if (transitionStatus) {
          try {
            const result = await this.compliance.transitionRecord(
              recordId,
              {
                toStatus: transitionStatus,
                reviewerId: userId || undefined,
                approverId: userId || undefined,
                reason,
              },
              user
            );
            complianceStatus = result?.status ?? null;
          } catch (err) {
            transitionError = (err instanceof Error && err.message) || 'Failed to transition governance status.';
          }
        }
        const updatedRow = (updated as any)?.row ? (updated as any).row : updated;
        const rowWithStatus = complianceStatus ? { ...updatedRow, complianceStatus } : updatedRow;
        if ((updated as any)?.row) {
          return {
            ...(updated as any),
            row: rowWithStatus,
            ...(transitionError ? { transitionError } : {}),
          };
        }
        return transitionError ? { row: rowWithStatus, transitionError } : rowWithStatus;
      }
      const result = await this.compliance.submitRecord(
        {
          workspaceId: database.workspaceId,
          databaseId: database.id,
          workflowVersionId,
          schemaVersionId,
          initialStatus: config?.initialStatus,
          data: sanitizedWithAssetTags,
        },
        user
      );
      const recordId = result?.record?.id;
      const dataWithCompliance = recordId
        ? { ...sanitizedWithAssetTags, [this.COMPLIANCE_RECORD_KEY]: recordId }
        : sanitizedWithAssetTags;
      return this.createDatabaseRow(database.pageId, { data: dataWithCompliance }, user, rowIdForCreate ? { rowId: rowIdForCreate } : {});
    }
    if (isUpdateMode) {
      const row = existingRow;
      if (!row) throw new Error('Row not found');
      const existing = existingData || {};
      const mergedData = { ...existing, ...sanitized };
      return this.updateDatabaseRow(row.id, { data: mergedData }, user);
    }
    return this.createDatabaseRow(database.pageId, { data: sanitizedWithAssetTags }, user, rowIdForCreate ? { rowId: rowIdForCreate } : {});
  }

  async createDatabaseField(
    pageId: string,
    payload: { name?: string; type?: DatabaseFieldType; options?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Field';
    const type: DatabaseFieldType =
      payload.type && Object.values(DatabaseFieldType).includes(payload.type) ? payload.type : DatabaseFieldType.TEXT;
    const position = payload.position ?? (await this.nextDatabaseFieldPosition(database.id));
    let options: Prisma.InputJsonValue = await this.sanitizeDatabaseFieldOptions(database, type, payload.options);
    if (type === DatabaseFieldType.RELATION) {
      options = await this.ensureRelationHistoryOptions(database, name, options, user);
    }
    return this.prisma.databaseField.create({
      data: {
        databaseId: database.id,
        name,
        type,
        options,
        position,
      },
    });
  }

  async updateDatabaseField(
    id: string,
    data: { name?: string; type?: DatabaseFieldType; options?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const field = await this.prisma.databaseField.findUnique({
      where: { id },
      select: { databaseId: true, name: true, type: true, options: true },
    });
    if (!field) throw new Error('Field not found');
    const database = await this.prisma.database.findUnique({
      where: { id: field.databaseId },
      select: { pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const updateData: Prisma.DatabaseFieldUpdateInput = {};
    if (typeof data.name === 'string') updateData.name = data.name.trim();
    const nextType =
      data.type && Object.values(DatabaseFieldType).includes(data.type) ? data.type : field.type || DatabaseFieldType.TEXT;
    if (data.type && Object.values(DatabaseFieldType).includes(data.type)) {
      updateData.type = nextType;
    }
    if (nextType === DatabaseFieldType.RELATION) {
      if (data.options === undefined && field.type !== DatabaseFieldType.RELATION) {
        throw new Error('Relation target is required.');
      }
      const nextOptions = data.options !== undefined ? data.options : field.options ?? {};
      const sanitizedOptions = await this.sanitizeDatabaseFieldOptions(
        { workspaceId: database.workspaceId, complianceMode: database.complianceMode },
        nextType,
        nextOptions
      );
      if (data.options !== undefined || field.type !== DatabaseFieldType.RELATION) {
        const fieldName = typeof data.name === 'string' ? data.name.trim() : field.name || 'Relation';
        const ensuredOptions = await this.ensureRelationHistoryOptions(database, fieldName, sanitizedOptions, user);
        updateData.options = ensuredOptions;
      }
    } else if (data.options !== undefined) {
      updateData.options = data.options;
    }
    if (data.position !== undefined) updateData.position = data.position;
    return this.prisma.databaseField.update({
      where: { id },
      data: updateData,
    });
  }

  async deleteDatabaseField(id: string, user?: { userId?: string; userName?: string }) {
    const field = await this.prisma.databaseField.findUnique({ where: { id }, select: { id: true, databaseId: true } });
    if (!field) throw new Error('Field not found');
    const database = await this.prisma.database.findUnique({ where: { id: field.databaseId }, select: { pageId: true } });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const rows = await this.prisma.databaseRow.findMany({ where: { databaseId: field.databaseId }, select: { id: true, data: true } });
    const updates = rows.map((row) => {
      const data = typeof row.data === 'object' && row.data !== null ? { ...(row.data as any) } : {};
      if (field.id in data) {
        delete data[field.id];
      }
      return this.prisma.databaseRow.update({ where: { id: row.id }, data: { data } });
    });
    if (updates.length) {
      await this.prisma.$transaction(updates);
    }
    const deleted = await this.prisma.databaseField.delete({ where: { id } });
    const forms = await this.prisma.databaseForm.findMany({
      where: { databaseId: field.databaseId },
      select: { id: true, fields: true },
    });
    // Clean every form first, then apply the updates in one transaction
    const cleanedForms = await Promise.all(
      forms.map(async (form) => {
        if (!Array.isArray(form.fields)) return null;
        const cleaned = await this.sanitizeDatabaseFormFields(field.databaseId, form.fields);
        return cleaned.length === form.fields.length ? null : { id: form.id, fields: cleaned };
      })
    );
    const toApply = cleanedForms
      .filter((form): form is NonNullable<typeof form> => !!form)
      .map((form) => this.prisma.databaseForm.update({ where: { id: form.id }, data: { fields: form.fields } }));
    if (toApply.length) {
      await this.prisma.$transaction(toApply);
    }
    return deleted;
  }

  async createDatabaseRow(
    pageId: string,
    payload: { data?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string },
    options: { rowId?: string } = {}
  ) {
    const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
    const databasePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, workspaceId: true, visibility: true, wikiHomeId: true },
    });
    const fields = await this.prisma.databaseField.findMany({
      where: { databaseId: database.id },
      select: { id: true, name: true, type: true, options: true, position: true },
    });
    const assetTagFieldIds = this.getAssetTagFieldIds(fields);
    const requestedRowId = typeof options.rowId === 'string' && isUuid(options.rowId) ? options.rowId : null;
    const rowId = requestedRowId || (assetTagFieldIds.length ? randomUUID() : null);
    const position = payload.position ?? (await this.nextDatabaseRowPosition(database.id));
    const data = payload.data ? await this.sanitizeDatabaseRowData(database.id, payload.data) : {};
    let dataWithAssetTags = rowId
      ? this.applyAssetTagValues(data as Record<string, any>, assetTagFieldIds, rowId)
      : (data as Record<string, any>);
    let complianceStatus: string | null = null;
    if (database.complianceMode) {
      const existingRecordId =
        dataWithAssetTags &&
        typeof dataWithAssetTags === 'object' &&
        !Array.isArray(dataWithAssetTags) &&
        typeof (dataWithAssetTags as Record<string, any>)[this.COMPLIANCE_RECORD_KEY] === 'string'
          ? (dataWithAssetTags as Record<string, any>)[this.COMPLIANCE_RECORD_KEY].trim()
          : '';
      if (isUuid(existingRecordId)) {
        const statusMap = await this.compliance.getRecordStatuses([existingRecordId], user, {
          workspaceId: database.workspaceId,
          databaseId: database.id,
        });
        complianceStatus = statusMap.get(existingRecordId) ?? null;
      } else {
        const { workflowVersionId, schemaVersionId } = await this.ensureComplianceVersions(database, fields, user);
        if (!workflowVersionId || !schemaVersionId) {
          throw new Error('Compliance workflow or schema is not configured.');
        }
        const complianceData =
          dataWithAssetTags && typeof dataWithAssetTags === 'object' && !Array.isArray(dataWithAssetTags)
            ? { ...(dataWithAssetTags as Record<string, any>) }
            : {};
        delete complianceData.__pageId;
        delete complianceData[this.COMPLIANCE_RECORD_KEY];
        const result = await this.compliance.submitRecord(
          {
            workspaceId: database.workspaceId,
            databaseId: database.id,
            workflowVersionId,
            schemaVersionId,
            data: complianceData,
          },
          user
        );
        const recordId = result?.record?.id;
        if (recordId) {
          dataWithAssetTags = { ...(dataWithAssetTags as Record<string, any>), [this.COMPLIANCE_RECORD_KEY]: recordId };
          complianceStatus = result?.record?.status ?? null;
        }
      }
    }
    const rawData =
      payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
        ? (payload.data as Record<string, any>)
        : null;
    const { field: titleField } = await this.ensureDatabaseTitleField(database.id);
    const hasTitleUpdate = !!(titleField?.id && rawData && Object.prototype.hasOwnProperty.call(rawData, titleField.id));
    const titleValue = hasTitleUpdate ? this.normalizePageTitle(rawData?.[titleField?.id as string]) : '';
    let pageRecord: { id: string } | null = null;
    if (hasTitleUpdate && databasePage) {
      pageRecord = await this.createDatabaseRowPage(databasePage, titleValue, user);
    }
    const dataWithPageId =
      pageRecord && dataWithAssetTags && typeof dataWithAssetTags === 'object' && !Array.isArray(dataWithAssetTags)
        ? { ...(dataWithAssetTags as Record<string, any>), __pageId: pageRecord.id }
        : dataWithAssetTags;
    const created = await this.prisma.databaseRow.create({
      data: {
        ...(rowId ? { id: rowId } : {}),
        databaseId: database.id,
        data: dataWithPageId,
        position,
        ...(pageRecord ? { pageId: pageRecord.id } : {}),
      },
    });
    if (!database.complianceMode) {
      await this.updateCollabDatabaseRowForPage({ pageId: database.pageId, workspaceId: database.workspaceId }, created);
      await this.pushCollabDatabaseRowUpdate({ pageId: database.pageId, workspaceId: database.workspaceId }, created);
    }
    await this.logRelationHistoryChanges({
      database: {
        id: database.id,
        pageId: database.pageId,
        workspaceId: database.workspaceId,
        complianceMode: database.complianceMode,
      },
      fields,
      rowId: created.id,
      previousData: null,
      nextData:
        created.data && typeof created.data === 'object' && !Array.isArray(created.data)
          ? (created.data as Record<string, any>)
          : null,
      user,
    });
    if (complianceStatus) {
      return { ...created, complianceStatus };
    }
    return created;
  }

  async updateDatabaseRow(
    id: string,
    data: { data?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    const updateData: Prisma.DatabaseRowUncheckedUpdateInput = {};
    const row = await this.prisma.databaseRow.findUnique({
      where: { id },
      select: { id: true, databaseId: true, pageId: true, data: true },
    });
    if (!row) throw new Error('Row not found');
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { id: true, pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const databasePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, workspaceId: true, visibility: true, wikiHomeId: true },
    });
    let fieldsForHistory: Array<{ id: string; name: string; type: DatabaseFieldType; options: Prisma.JsonValue | null }> | null = null;
    let previousData: Record<string, any> | null = null;
    let nextData: Record<string, any> | null = null;
    const { field: titleField } = await this.ensureDatabaseTitleField(row.databaseId);
    const rawData =
      data.data && typeof data.data === 'object' && !Array.isArray(data.data) ? (data.data as Record<string, any>) : null;
    const hasTitleUpdate = !!(titleField?.id && rawData && Object.prototype.hasOwnProperty.call(rawData, titleField.id));
    const titleValue = hasTitleUpdate ? this.normalizePageTitle(rawData?.[titleField?.id as string]) : '';
    let pageRecord: any = null;
    if (data.data !== undefined) {
      const sanitized = await this.sanitizeDatabaseRowData(row.databaseId, data.data);
      const fields = await this.prisma.databaseField.findMany({
        where: { databaseId: row.databaseId },
        select: { id: true, name: true, type: true, options: true },
      });
      fieldsForHistory = fields;
      const assetTagFieldIds = this.getAssetTagFieldIds(fields);
      const existingData =
        row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, any>) : null;
      const updatedData = assetTagFieldIds.length
        ? this.applyAssetTagValuesFromExisting(sanitized as Record<string, any>, assetTagFieldIds, existingData, row.id)
        : (sanitized as Record<string, any>);
      if (database.complianceMode && existingData) {
        const recordId = typeof existingData[this.COMPLIANCE_RECORD_KEY] === 'string' ? existingData[this.COMPLIANCE_RECORD_KEY] : '';
        if (isUuid(recordId) && !Object.prototype.hasOwnProperty.call(updatedData, this.COMPLIANCE_RECORD_KEY)) {
          updatedData[this.COMPLIANCE_RECORD_KEY] = recordId;
        }
      }
      updateData.data = updatedData;
      previousData = existingData;
      nextData = updateData.data && typeof updateData.data === 'object' && !Array.isArray(updateData.data) ? (updateData.data as Record<string, any>) : null;
    }
    if (data.position !== undefined) updateData.position = data.position;
    if (hasTitleUpdate && databasePage) {
      if (!row.pageId) {
        pageRecord = await this.createDatabaseRowPage(databasePage, titleValue, user);
        updateData.pageId = pageRecord.id;
      }
      const pageId = row.pageId || pageRecord?.id || null;
      if (pageId) {
        pageRecord = await this.prisma.page.update({
          where: { id: pageId },
          data: { title: titleValue },
        });
        await this.updateCollabTitleForPage(
          { id: pageRecord.id, workspaceId: pageRecord.workspaceId, kind: pageRecord.kind },
          pageRecord.title
        );
        if (updateData.data && typeof updateData.data === 'object' && !Array.isArray(updateData.data)) {
          (updateData.data as Record<string, any>).__pageId = pageId;
        }
      }
    }
    const updatedRow = await this.prisma.databaseRow.update({
      where: { id },
      data: updateData,
    });
    if (!database.complianceMode && (updateData.data !== undefined || updateData.pageId !== undefined)) {
      await this.updateCollabDatabaseRowForPage({ pageId: database.pageId, workspaceId: database.workspaceId }, updatedRow);
      await this.pushCollabDatabaseRowUpdate({ pageId: database.pageId, workspaceId: database.workspaceId }, updatedRow);
    }
    if (fieldsForHistory && updateData.data !== undefined) {
      await this.logRelationHistoryChanges({
        database,
        fields: fieldsForHistory,
        rowId: updatedRow.id,
        previousData,
        nextData:
          updatedRow.data && typeof updatedRow.data === 'object' && !Array.isArray(updatedRow.data)
            ? (updatedRow.data as Record<string, any>)
            : nextData,
        user,
      });
    }
    if (pageRecord) {
      return { row: updatedRow, page: pageRecord };
    }
    return updatedRow;
  }

  async ensureDatabaseRowPage(
    id: string,
    payload: { title?: string; pageId?: string; data?: Prisma.InputJsonValue; position?: Prisma.Decimal },
    user?: { userId?: string; userName?: string }
  ) {
    let row = await this.prisma.databaseRow.findUnique({
      where: { id },
      select: { id: true, databaseId: true, pageId: true, data: true },
    });
    if (!row) {
      const pageId = isUuid(payload.pageId) ? payload.pageId : null;
      if (!pageId) throw new Error('Row not found');
      const database = await this.getDatabaseForPage(pageId, user, { requireWrite: true });
      const position = payload.position ?? (await this.nextDatabaseRowPosition(database.id));
      const data = payload.data ? await this.sanitizeDatabaseRowData(database.id, payload.data) : {};
      row = await this.prisma.databaseRow.create({
        data: {
          id,
          databaseId: database.id,
          data,
          position,
        },
        select: { id: true, databaseId: true, pageId: true, data: true },
      });
    }
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { pageId: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    if (row.pageId) {
      const page = await this.prisma.page.findUnique({ where: { id: row.pageId } });
      if (page && typeof payload.title === 'string') {
        const nextTitle = this.normalizePageTitle(payload.title);
        const updatedPage = await this.prisma.page.update({
          where: { id: row.pageId },
          data: { title: nextTitle },
        });
        await this.updateCollabTitleForPage(
          { id: updatedPage.id, workspaceId: updatedPage.workspaceId, kind: updatedPage.kind },
          updatedPage.title
        );
        return { row, page: updatedPage };
      }
      return { row, page };
    }
    const databasePage = await this.prisma.page.findUnique({
      where: { id: database.pageId },
      select: { id: true, workspaceId: true, visibility: true, wikiHomeId: true },
    });
    if (!databasePage) throw new Error('Database page not found');
    const titleFieldId = await this.resolveDatabaseTitleFieldId(row.databaseId);
    const fallbackTitle =
      titleFieldId && row.data && typeof row.data === 'object' && !Array.isArray(row.data)
        ? (row.data as Record<string, any>)[titleFieldId]
        : undefined;
    const nextTitle = this.normalizePageTitle(payload.title ?? fallbackTitle);
    const page = await this.createDatabaseRowPage(databasePage, nextTitle, user);
    const nextData = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? { ...row.data } : {};
    nextData.__pageId = page.id;
    let updatedRow;
    try {
      updatedRow = await this.prisma.databaseRow.update({
        where: { id },
        data: { pageId: page.id, data: nextData },
      });
    } catch (err) {
      updatedRow = await this.prisma.databaseRow.update({
        where: { id },
        data: { data: nextData },
      });
    }
    return { row: updatedRow, page };
  }

  async deleteDatabaseRow(id: string, user?: { userId?: string; userName?: string }) {
    const row = await this.prisma.databaseRow.findUnique({ where: { id }, select: { databaseId: true } });
    if (!row) throw new Error('Row not found');
    const database = await this.prisma.database.findUnique({
      where: { id: row.databaseId },
      select: { pageId: true, workspaceId: true, complianceMode: true },
    });
    if (!database) throw new Error('Database not found');
    await this.requirePageAccess(database.pageId, user, { requireWrite: true });
    const deleted = await this.prisma.databaseRow.delete({ where: { id } });
    if (!database.complianceMode) {
      await this.deleteCollabDatabaseRowForPage({ pageId: database.pageId, workspaceId: database.workspaceId }, id);
      await this.pushCollabDatabaseRowDelete({ pageId: database.pageId, workspaceId: database.workspaceId }, id);
    }
    return deleted;
  }

  async loginWithCredentials(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return { user: this.stripPassword(user) };
  }

  async getUserProfile(id: string, user?: { userId?: string; userName?: string }) {
    if (!user?.userId) {
      throw new BadRequestException('userId is required');
    }
    if (user.userId !== id && !this.isSystemAdmin(user.userId)) {
      throw new ForbiddenException('User access required');
    }
    const found = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return this.stripPassword(found);
  }

  async updateUserPreferences(
    id: string,
    payload: unknown,
    user?: { userId?: string; userName?: string }
  ) {
    if (!user?.userId) {
      throw new Error('userId is required');
    }
    if (user.userId !== id) {
      throw new Error('Forbidden: user access required');
    }
    const nextPrefs = this.sanitizeUserPreferences(payload);
    const existing = await this.prisma.user.findUnique({ where: { id }, select: { preferences: true } });
    if (!existing) {
      throw new Error('User not found');
    }
    const current =
      existing.preferences && typeof existing.preferences === 'object' && !Array.isArray(existing.preferences)
        ? (existing.preferences as Record<string, any>)
        : {};
    const merged = { ...current, ...nextPrefs };
    return this.prisma.user.update({
      where: { id },
      data: { preferences: merged },
    });
  }

  private async collectDescendantIds(rootId: string): Promise<string[]> {
    const ids: string[] = [];
    const stack = [rootId];
    while (stack.length) {
      const currentBatch = stack.splice(0, stack.length);
      const children = await this.prisma.page.findMany({
        where: { parentId: { in: currentBatch } },
        select: { id: true },
      });
      const childIds = children.map((c) => c.id);
      ids.push(...childIds);
      stack.push(...childIds);
    }
    return ids;
  }

  async deletePage(id: string, user?: { userId?: string; userName?: string }) {
    await this.requirePageAccess(id, user, { requireWrite: true });
    const descendantIds = await this.collectDescendantIds(id);
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
      throw new Error('Cannot delete private pages you do not own');
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
    await Promise.all(ids.map((pageId) => this.requirePageAccess(pageId, user, { requireWrite: true, allowDeleted: true })));
    const pages = await this.prisma.page.findMany({ where: { id: { in: ids } }, select: { id: true, workspaceId: true } });
    const docNames = pages.flatMap((page) => [`ws:${page.workspaceId}:${page.id}`, `ws:${page.workspaceId}:db:${page.id}`]);
    if (docNames.length) {
      await this.prisma.collabDoc.deleteMany({ where: { documentName: { in: docNames } } });
    }
    const databases = await this.prisma.database.findMany({ where: { pageId: { in: ids } }, select: { id: true } });
    const databaseIds = databases.map((db) => db.id);
    if (databaseIds.length) {
      await this.prisma.databaseForm.deleteMany({ where: { databaseId: { in: databaseIds } } });
      await this.prisma.databaseRow.deleteMany({ where: { databaseId: { in: databaseIds } } });
      await this.prisma.databaseField.deleteMany({ where: { databaseId: { in: databaseIds } } });
      await this.prisma.database.deleteMany({ where: { id: { in: databaseIds } } });
    }
    await this.prisma.block.deleteMany({ where: { pageId: { in: ids } } });
    const result = await this.prisma.page.deleteMany({ where: { id: { in: ids } } });
    return result;
  }

  async restorePage(id: string, user?: { userId?: string; userName?: string }) {
    await this.requirePageAccess(id, user, { requireWrite: true, allowDeleted: true });
    const descendantIds = await this.collectDescendantIds(id);
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
      throw new Error('orderedIds required');
    }

    await this.requirePageAccess(orderedIds[0], user, { requireWrite: true });
    const anchor = await this.prisma.page.findUnique({
      where: { id: orderedIds[0] },
      select: { workspaceId: true, isDeleted: true },
    });
    if (!anchor) {
      throw new Error('first orderedId not found');
    }
    if (anchor.isDeleted) {
      throw new Error('cannot reorder deleted pages');
    }

    const workspaceId = anchor.workspaceId;
    if (parentId) {
      const parent = await this.prisma.page.findUnique({ where: { id: parentId }, select: { workspaceId: true, isDeleted: true } });
      if (!parent || parent.isDeleted || parent.workspaceId !== workspaceId) {
        throw new Error('parent does not exist in workspace');
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
      throw new Error('orderedIds must be unique');
    }

    const orderedPages = await this.prisma.page.findMany({
      where: { id: { in: uniqueOrdered }, workspaceId, isDeleted: false },
      select: { id: true, position: true, workspaceId: true, visibility: true, authorId: true, wikiHomeId: true },
    });
    if (orderedPages.length !== uniqueOrdered.length) {
      throw new Error('orderedIds must all exist and be active in the workspace');
    }
    const forbiddenPrivate = orderedPages.find(
      (page) => page.visibility === PageVisibility.PRIVATE && page.authorId !== user?.userId
    );
    if (forbiddenPrivate) {
      throw new Error('Cannot reorder private pages you do not own');
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
        newPos.set(id, prev.plus(this.POSITION_INCREMENT));
      } else if (!prev && next) {
        newPos.set(id, next.minus(this.POSITION_INCREMENT));
      } else {
        newPos.set(id, this.POSITION_INCREMENT);
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
          position: newPos.get(id) ?? this.POSITION_INCREMENT,
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
        const descendantIds = await this.collectDescendantIds(page.id);
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
      await this.ensureWikiRowsForHome(targetWikiHomeId);
    }
    return { count: orderedIds.length, normalized: normalize };
  }

  async resetAllWorkspaces(adminId?: string, confirm?: string) {
    this.ensureAdmin(adminId);
    if (!confirm || typeof confirm !== 'string') {
      throw new Error('confirm is required');
    }
    if (confirm.trim() !== this.RESET_WORKSPACES_CONFIRM_TEXT) {
      throw new Error(`confirm must match "${this.RESET_WORKSPACES_CONFIRM_TEXT}"`);
    }

    const users = await this.prisma.user.findMany({ select: { id: true, displayName: true } });
    this.locks.clear();

    const deleted = await this.prisma.$transaction(async (tx) => {
      const databaseRows = await tx.databaseRow.deleteMany();
      const databaseFields = await tx.databaseField.deleteMany();
      const databases = await tx.database.deleteMany();
      const childBlocks = await tx.block.deleteMany({ where: { parentId: { not: null } } });
      const rootBlocks = await tx.block.deleteMany({ where: { parentId: null } });
      const childPages = await tx.page.deleteMany({ where: { parentId: { not: null } } });
      const rootPages = await tx.page.deleteMany({ where: { parentId: null } });
      const collabDocs = await tx.collabDoc.deleteMany();
      const memberships = await tx.userWorkspace.deleteMany();
      const workspaces = await tx.workspace.deleteMany();
      return {
        databaseRows: databaseRows.count,
        databaseFields: databaseFields.count,
        databases: databases.count,
        blocks: childBlocks.count + rootBlocks.count,
        pages: childPages.count + rootPages.count,
        collabDocs: collabDocs.count,
        memberships: memberships.count,
        workspaces: workspaces.count,
      };
    });

    const created = await this.prisma.$transaction(async (tx) => {
      let workspaceCount = 0;
      let membershipCount = 0;
      for (const user of users) {
        const name = `${user.displayName || user.id}'s Workspace`;
        const workspace = await tx.workspace.create({
          data: { name, personalOwnerId: user.id },
        });
        workspaceCount += 1;
        await tx.userWorkspace.create({
          data: { userId: user.id, workspaceId: workspace.id, role: WorkspaceRole.OWNER },
        });
        membershipCount += 1;
      }
      return { users: users.length, workspaces: workspaceCount, memberships: membershipCount };
    });

    return { deleted, created };
  }

  // ── User management (admin) ────────────────────────────────────────────

  async listUsers(adminId?: string) {
    assertSystemAdmin(adminId);
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.stripPassword(u));
  }

  async adminCreateUser(adminId: string, payload: { displayName: string; email: string; password: string }) {
    assertSystemAdmin(adminId);
    const { displayName, email, password } = payload;
    if (!displayName?.trim()) throw new BadRequestException('displayName is required');
    if (!email?.trim()) throw new BadRequestException('email is required');
    if (!password) throw new BadRequestException('password is required');
    const existing = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) throw new BadRequestException('A user with that email already exists');
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        displayName: displayName.trim(),
        passwordHash,
      },
    });
    await this.ensureDefaultWorkspaces(user.id, user.displayName);
    return this.stripPassword(user);
  }

  async adminUpdateUser(adminId: string, userId: string, payload: { displayName?: string; email?: string }) {
    assertSystemAdmin(adminId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const data: { displayName?: string; email?: string } = {};
    if (typeof payload.displayName === 'string' && payload.displayName.trim()) {
      data.displayName = payload.displayName.trim();
    }
    if (typeof payload.email === 'string' && payload.email.trim()) {
      const emailNorm = payload.email.toLowerCase().trim();
      const clash = await this.prisma.user.findUnique({ where: { email: emailNorm } });
      if (clash && clash.id !== userId) throw new BadRequestException('A user with that email already exists');
      data.email = emailNorm;
    }
    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    return this.stripPassword(updated);
  }

  async adminResetPassword(adminId: string, userId: string, newPassword: string) {
    assertSystemAdmin(adminId);
    if (!newPassword) throw new BadRequestException('newPassword is required');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }

  async adminDeleteUser(adminId: string, userId: string) {
    assertSystemAdmin(adminId);
    if (userId === SYSTEM_ADMIN_ID) throw new BadRequestException('Cannot delete the system admin');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }

  // ── Self-service password change ───────────────────────────────────────

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new NotFoundException('User not found');
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }
}
