import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WorkspaceRole, PageVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isUuid } from '../utils/uuid.util';
import { assertSystemAdmin } from '../utils/assert-admin.util';
import { isSystemAdmin, canEdit } from './pages.shared';

// Who may do what: workspace lookup and membership, roles, and page access checks.
// The bottom layer; every other page service builds on it.
@Injectable()
export class PageAccessService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async ensureUser(userId?: string, userName?: string) {
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

  async resolveWorkspaceByKeyOrId(workspaceKey: string, userId?: string, userName?: string) {
    const key = workspaceKey || 'global';
    if (isUuid(key)) {
      const existingById = await this.prisma.workspace.findUnique({ where: { id: key } });
      if (!existingById) {
        throw new NotFoundException('Workspace not found');
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
        throw new ForbiddenException('Forbidden: personal workspace access denied');
      }
      const personal = await this.prisma.workspace.findFirst({ where: { personalOwnerId: targetUserId } });
      if (!personal) throw new NotFoundException('Workspace not found');
      return personal;
    }
    throw new BadRequestException('Workspace key not supported');
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

  async ensureMembership(userId: string, workspaceId: string, role: WorkspaceRole = WorkspaceRole.EDITOR) {
    const member = await this.prisma.userWorkspace.findFirst({ where: { userId, workspaceId } });
    if (member) return member;
    return this.prisma.userWorkspace.create({ data: { userId, workspaceId, role } });
  }

  async ensureDefaultWorkspaces(userId: string, userName?: string) {
    await this.ensureUser(userId, userName);
    const personalWorkspace = await this.ensurePersonalWorkspace(userId, userName);
    await this.ensureMembership(userId, personalWorkspace.id, WorkspaceRole.OWNER);
    return { personalWorkspace };
  }

  async getMembership(userId: string, workspaceId: string) {
    return this.prisma.userWorkspace.findFirst({ where: { userId, workspaceId } });
  }

  async requireMembership(userId: string, workspaceId: string) {
    if (isSystemAdmin(userId)) {
      return { userId, workspaceId, role: WorkspaceRole.OWNER };
    }
    const member = await this.getMembership(userId, workspaceId);
    if (!member) {
      throw new ForbiddenException('Forbidden: workspace access required');
    }
    return member;
  }

  async getWorkspaceMemberships(userId: string) {
    return this.prisma.userWorkspace.findMany({
      where: { userId },
      select: { workspaceId: true, role: true },
    });
  }

  async requireWorkspaceRole(userId: string, workspaceId: string, allowed: WorkspaceRole[]) {
    if (isSystemAdmin(userId)) {
      return { userId, workspaceId, role: WorkspaceRole.OWNER };
    }
    const membership = await this.requireMembership(userId, workspaceId);
    if (!allowed.includes(membership.role)) {
      throw new ForbiddenException('Forbidden: insufficient workspace role');
    }
    return membership;
  }

  async ensureNotLastOwner(workspaceId: string) {
    const ownerCount = await this.prisma.userWorkspace.count({
      where: { workspaceId, role: WorkspaceRole.OWNER },
    });
    if (ownerCount <= 1) {
      throw new BadRequestException('Workspace must have at least one owner');
    }
  }

  async requirePageAccess(
    pageId: string,
    user?: { userId?: string; userName?: string },
    options: { requireWrite?: boolean; allowDeleted?: boolean } = {}
  ) {
    const userId = user?.userId;
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    const isAdmin = isSystemAdmin(userId);
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
      throw new NotFoundException('Page is in the bin');
    }
    const membership = await this.requireMembership(userId, page.workspaceId);
    if (page.visibility === PageVisibility.PRIVATE && !isAdmin) {
      if (membership.role === WorkspaceRole.VIEWER) {
        throw new ForbiddenException('Forbidden: private page access denied');
      }
      if (!page.authorId || page.authorId !== userId) {
        throw new ForbiddenException('Forbidden: private page access denied');
      }
    }
    if (options.requireWrite && !canEdit(membership.role)) {
      throw new ForbiddenException('Forbidden: editor access required');
    }
    return { page, membership };
  }

  async ensurePageReadAccess(pageId: string, user?: { userId?: string; userName?: string }) {
    return this.requirePageAccess(pageId, user);
  }

  async ensurePageWriteAccess(pageId: string, user?: { userId?: string; userName?: string }) {
    return this.requirePageAccess(pageId, user, { requireWrite: true });
  }

  async ensureWorkspaceReadAccess(workspaceId: string, user?: { userId?: string; userName?: string }) {
    if (!user?.userId) throw new BadRequestException('userId is required');
    if (!isUuid(workspaceId)) throw new NotFoundException('Workspace not found');
    return this.requireMembership(user.userId, workspaceId);
  }

  // Pages in a workspace that this user can't open: other people's private pages, and all
  // private pages for viewers. Mirrors the visibility rules in listPages and requirePageAccess.
  async listHiddenPageIds(workspaceId: string, userId: string) {
    if (isSystemAdmin(userId)) return [];
    const membership = await this.requireMembership(userId, workspaceId);
    const hidden = await this.prisma.page.findMany({
      where: {
        workspaceId,
        visibility: PageVisibility.PRIVATE,
        ...(membership.role === WorkspaceRole.VIEWER ? {} : { NOT: { authorId: userId } }),
      },
      select: { id: true },
    });
    return hidden.map((page) => page.id);
  }

  // Admin-only actions check identity only. isSystemAdmin() also covers the dev-only
  // permission bypass, so it's false in production and locked the admin out of these.
  ensureAdmin(adminId?: string) {
    assertSystemAdmin(adminId);
  }

  async collectDescendantIds(rootId: string): Promise<string[]> {
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
}
