import { Injectable, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deleteDatabasesWithContents } from '../utils/delete-databases.util';
import { isUuid } from '../utils/uuid.util';
import { PageAccessService } from './page-access.service';
import { PagesService } from './pages.service';
import { isSystemAdmin } from './pages.shared';
import { SYSTEM_ADMIN_ID } from '../constants/system-admin.const';
import { loginLookup } from './username.util';

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
      updatedAt: true,
      _count: { select: { pages: { where: { isDeleted: false, isHidden: false } } } },
    };
    // Every workspace (names, page counts, when a page in it last changed; not its pages), as
    // if owned by `asUserId`: the admin panel, and the dev-only admin bypass
    const listAll = async (asUserId: string) => {
      const workspaces = await this.prisma.workspace.findMany({
        select: { ...workspaceSelect, personalOwnerId: true },
        orderBy: { createdAt: 'asc' },
      });
      const lastPageChange = await this.prisma.page.groupBy({ by: ['workspaceId'], _max: { updatedAt: true } });
      const lastChangeById = new Map(lastPageChange.map((row) => [row.workspaceId, row._max.updatedAt]));
      return workspaces.map((workspace) => ({
        userId: asUserId,
        workspaceId: workspace.id,
        role: WorkspaceRole.OWNER,
        workspace: { ...workspace, lastPageChangeAt: lastChangeById.get(workspace.id) ?? null },
      }));
    };
    // The admin panel. It checked the dev-only admin bypass, so in production an admin saw only their own.
    if (adminId) {
      this.access.ensureAdmin(adminId);
      return listAll(adminId);
    }
    if (userId) {
      if (isSystemAdmin(userId)) return listAll(userId);
      // The workspaces first, then this user's membership of each. Reading the memberships first
      // and then their workspaces failed outright ("workspace is required") when one was deleted
      // in between; this way a workspace deleted meanwhile is just left out.
      const workspaces = await this.prisma.workspace.findMany({
        where: { memberships: { some: { userId } } },
        select: { ...workspaceSelect, memberships: { where: { userId } } },
      });
      return workspaces
        .flatMap(({ memberships, ...workspace }) => (memberships[0] ? [{ ...memberships[0], workspace }] : []))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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
    // Its owners, or the system admin (cleaning up an abandoned one; in production too), but not
    // someone's personal workspace: that's theirs alone
    const membership = await this.access.getMembership(userId, workspaceId);
    const byAdmin = userId === SYSTEM_ADMIN_ID && membership?.role !== WorkspaceRole.OWNER;
    if (byAdmin && workspace.personalOwnerId) {
      throw new ForbiddenException("The system admin can't delete someone's personal workspace");
    }
    if (!byAdmin && (!membership || membership.role !== WorkspaceRole.OWNER)) {
      throw new ForbiddenException('Only workspace owners can delete this workspace');
    }
    // Its own record of what the admin did goes with it: this one stays in the server's log
    if (byAdmin) console.warn(`[admin] the system admin deleted workspace "${workspace.name}" (${workspaceId})`);
    // Postgres can pick this to cancel when it deadlocks with a database being saved from its live
    // document at the same moment; trying again then goes through
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.prisma.$transaction((tx) => this.removeWorkspace(tx, workspaceId));
        break;
      } catch (err) {
        if (attempt >= 3 || !String((err as Error)?.message || '').includes('40P01')) throw err;
      }
    }
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
    payload: { login?: string; userId?: string; role?: WorkspaceRole },
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
    // The admin repairs a workspace (an owner for one nobody can manage); giving other people access
    // is its owners' to do. Not a personal workspace: that's its person's alone.
    if (adminId && role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException("The system admin can only set an owner; the workspace's owners add other members");
    }
    if (adminId) await this.ensureNotPersonal(workspaceId);
    const user = await this.findUserForMembership(payload);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === user.id && role !== WorkspaceRole.OWNER) {
      throw new BadRequestException('Personal workspace owners must remain owners');
    }
    // Adding someone who's already a member would quietly change their role, skipping the checks a
    // role change has (an owner demoting themselves, the last owner): owners do that in the members
    // list. A system admin's "Assign user" still sets the role: it's how they repair a workspace.
    const existing = await this.prisma.userWorkspace.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } } });
    if (existing && !adminId) {
      if (existing.role === role) return existing;
      throw new ConflictException('Already a member: change their role in the members list');
    }
    // Already an owner: nothing changes, and nothing's recorded
    if (adminId && existing?.role === WorkspaceRole.OWNER) return existing;
    // The change and its record together (neither without the other)
    return this.prisma.$transaction(async (tx) => {
      const saved = await tx.userWorkspace.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId } },
        update: { role },
        create: { userId: user.id, workspaceId, role },
      });
      if (adminId) await this.recordAdminAction(tx, workspaceId, 'SET_OWNER', user);
      return saved;
    });
  }

  private async ensureNotPersonal(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.personalOwnerId) throw new ForbiddenException("The system admin can't change someone's personal workspace");
  }

  /** Notes what the system admin changed in a workspace, for its members to see (listAdminActions). */
  private async recordAdminAction(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    action: 'SET_OWNER' | 'REMOVE_MEMBER',
    user: { id: string; displayName?: string | null; email?: string | null },
  ) {
    await tx.workspaceAdminAction.create({
      data: { workspaceId, action, targetUserId: user.id, targetName: user.displayName || user.email || '' },
    });
  }

  /** What the system admin has changed in a workspace, newest first: for its members (and the admin). */
  async listAdminActions(userId: string | undefined, workspaceId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    if (!isUuid(workspaceId)) throw new NotFoundException('Workspace not found');
    if (userId !== SYSTEM_ADMIN_ID) await this.access.requireMembership(userId, workspaceId);
    return this.prisma.workspaceAdminAction.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, action: true, targetUserId: true, targetName: true, createdAt: true },
    });
  }

  // Members are existing accounts, found by email (or exact user ID). Never create a user
  // here: that used to turn a name or mistyped ID into an account nobody could log in to.
  // `login` is an email address or a username.
  private async findUserForMembership(payload: { login?: string; userId?: string }) {
    const login = payload.login?.trim().toLowerCase();
    if (login) {
      const user = await this.prisma.user.findUnique({ where: loginLookup(login) });
      if (!user) {
        const what = login.includes('@') ? 'email' : 'username';
        throw new NotFoundException(`No user with the ${what} ${login}. Create their account first (Admin → Users).`);
      }
      return user;
    }
    if (payload.userId && isUuid(payload.userId)) {
      const user = await this.prisma.user.findUnique({ where: { id: payload.userId } });
      if (!user) throw new NotFoundException('User not found');
      return user;
    }
    throw new BadRequestException('Enter the email address or username of the person to add');
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
    if (adminId && nextRole !== WorkspaceRole.OWNER) {
      throw new ForbiddenException("The system admin can only make someone an owner; the workspace's owners change other roles");
    }
    if (adminId) await this.ensureNotPersonal(workspaceId);
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
    if (adminId && membership.role === nextRole) {
      return this.prisma.userWorkspace.findUniqueOrThrow({ where: { id: membership.id } });
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.userWorkspace.update({
        where: { id: membership.id },
        data: { role: nextRole },
        include: { user: { select: { id: true, displayName: true, email: true } } },
      });
      if (adminId) await this.recordAdminAction(tx, workspaceId, 'SET_OWNER', updated.user);
      const { user: _user, ...membershipOnly } = updated;
      return membershipOnly;
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
    if (adminId) await this.ensureNotPersonal(workspaceId);
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { personalOwnerId: true } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    if (workspace.personalOwnerId && workspace.personalOwnerId === memberId) {
      throw new BadRequestException('Personal workspace owners must remain owners');
    }
    const membership = await this.prisma.userWorkspace.findFirst({
      where: { userId: memberId, workspaceId },
      select: { id: true, role: true, user: { select: { id: true, displayName: true, email: true } } },
    });
    if (!membership) {
      return { count: 0 };
    }
    if (membership.role === WorkspaceRole.OWNER) {
      await this.access.ensureNotLastOwner(workspaceId);
    }
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.userWorkspace.deleteMany({ where: { userId: memberId, workspaceId } });
      if (adminId) await this.recordAdminAction(tx, workspaceId, 'REMOVE_MEMBER', membership.user);
      return removed;
    });
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
