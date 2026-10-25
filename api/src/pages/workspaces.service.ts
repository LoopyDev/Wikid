import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deleteDatabasesWithContents } from '../utils/delete-databases.util';
import { isUuid } from '../utils/uuid.util';
import { PageAccessService } from './page-access.service';
import { PagesService } from './pages.service';
import { isSystemAdmin } from './pages.shared';

// Workspaces and their members, plus the admin reset of all workspaces.
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly pages: PagesService,
  ) {}

  private readonly RESET_WORKSPACES_CONFIRM_TEXT = 'RESET ALL WORKSPACES';

  async listSharedWorkspaces(adminId?: string) {
    this.access.ensureAdmin(adminId);
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
    if (adminId && isSystemAdmin(adminId)) {
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
      if (isSystemAdmin(userId)) {
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
      throw new BadRequestException('name is required');
    }
    if (!payload.userId) {
      throw new BadRequestException('userId is required');
    }
    const user = await this.access.ensureUser(payload.userId, payload.userName);
    const existing = await this.prisma.workspace.findFirst({ where: { name } });
    if (existing) {
      throw new ConflictException('Workspace name already exists');
    }
    const workspace = await this.prisma.workspace.create({ data: { name } });
    await this.access.ensureMembership(user.id, workspace.id, WorkspaceRole.OWNER);
    return { workspace, role: WorkspaceRole.OWNER };
  }

  async updateWorkspace(workspaceId: string, data: { name?: string }, userId: string) {
    if (!workspaceId || !userId) throw new BadRequestException('workspaceId and userId are required');
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (!isSystemAdmin(userId)) {
      const membership = await this.access.getMembership(userId, workspaceId);
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
    if (!isSystemAdmin(userId)) {
      const membership = await this.access.getMembership(userId, workspaceId);
      if (!membership || membership.role !== WorkspaceRole.OWNER) {
        throw new ForbiddenException('Only workspace owners can delete this workspace');
      }
    }
    await this.prisma.$transaction((tx) => this.removeWorkspace(tx, workspaceId));
    return { ok: true };
  }

  // Deletes a workspace and everything in it. Callers check permissions.
  async removeWorkspace(tx: Prisma.TransactionClient, workspaceId: string) {
    const pageIds = (await tx.page.findMany({ where: { workspaceId }, select: { id: true } })).map((p) => p.id);
    await this.pages.removePages(tx, pageIds);
    await tx.collabDoc.deleteMany({ where: { documentName: { startsWith: `ws:${workspaceId}:` } } });
    await tx.userWorkspace.deleteMany({ where: { workspaceId } });
    await tx.workspace.delete({ where: { id: workspaceId } });
  }

  async listWorkspaceMembers(userId: string | undefined, workspaceId: string, adminId?: string) {
    if (adminId) {
      this.access.ensureAdmin(adminId);
    } else if (!userId) {
      throw new BadRequestException('userId is required');
    } else {
      await this.access.requireMembership(userId, workspaceId);
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
      this.access.ensureAdmin(adminId);
    } else if (!userId) {
      throw new BadRequestException('userId is required');
    } else {
      await this.access.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    }
    const role: WorkspaceRole = payload.role && Object.values(WorkspaceRole).includes(payload.role) ? payload.role : WorkspaceRole.EDITOR;
    const user = await this.findUserForMembership(payload);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === user.id && role !== WorkspaceRole.OWNER) {
      throw new BadRequestException('Personal workspace owners must remain owners');
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
      this.access.ensureAdmin(adminId);
    } else if (!userId) {
      throw new BadRequestException('userId is required');
    } else {
      await this.access.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    }
    const nextRole: WorkspaceRole = role && Object.values(WorkspaceRole).includes(role) ? role : WorkspaceRole.EDITOR;
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === memberId && nextRole !== WorkspaceRole.OWNER) {
      throw new BadRequestException('Personal workspace owners must remain owners');
    }
    const membership = await this.prisma.userWorkspace.findFirst({
      where: { userId: memberId, workspaceId },
      select: { id: true, role: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    if (membership.role === WorkspaceRole.OWNER && nextRole !== WorkspaceRole.OWNER) {
      await this.access.ensureNotLastOwner(workspaceId);
    }
    return this.prisma.userWorkspace.update({
      where: { id: membership.id },
      data: { role: nextRole },
    });
  }

  async removeWorkspaceMember(userId: string | undefined, workspaceId: string, memberId: string, adminId?: string) {
    if (adminId) {
      this.access.ensureAdmin(adminId);
    } else if (!userId) {
      throw new BadRequestException('userId is required');
    } else {
      await this.access.requireWorkspaceRole(userId, workspaceId, [WorkspaceRole.OWNER]);
    }
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === memberId) {
      throw new BadRequestException('Personal workspace owners must remain owners');
    }
    const membership = await this.prisma.userWorkspace.findFirst({
      where: { userId: memberId, workspaceId },
      select: { id: true, role: true },
    });
    if (!membership) {
      return { count: 0 };
    }
    if (membership.role === WorkspaceRole.OWNER) {
      await this.access.ensureNotLastOwner(workspaceId);
    }
    return this.prisma.userWorkspace.deleteMany({ where: { userId: memberId, workspaceId } });
  }

  async resetAllWorkspaces(adminId?: string, confirm?: string) {
    this.access.ensureAdmin(adminId);
    if (!confirm || typeof confirm !== 'string') {
      throw new BadRequestException('confirm is required');
    }
    if (confirm.trim() !== this.RESET_WORKSPACES_CONFIRM_TEXT) {
      throw new BadRequestException(`confirm must match "${this.RESET_WORKSPACES_CONFIRM_TEXT}"`);
    }

    const users = await this.prisma.user.findMany({ select: { id: true, displayName: true } });
    this.pages.clearLocks();

    const deleted = await this.prisma.$transaction(async (tx) => {
      const databases = await deleteDatabasesWithContents(tx);
      const childBlocks = await tx.block.deleteMany({ where: { parentId: { not: null } } });
      const rootBlocks = await tx.block.deleteMany({ where: { parentId: null } });
      const childPages = await tx.page.deleteMany({ where: { parentId: { not: null } } });
      const rootPages = await tx.page.deleteMany({ where: { parentId: null } });
      const collabDocs = await tx.collabDoc.deleteMany();
      const memberships = await tx.userWorkspace.deleteMany();
      const workspaces = await tx.workspace.deleteMany();
      return {
        databaseRows: databases.rows,
        databaseFields: databases.fields,
        databases: databases.databases,
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
}
