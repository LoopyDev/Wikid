import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { WorkspaceRole, PageVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ADMIN_ID } from '../constants/system-admin.const';
import { assertSystemAdmin } from '../utils/assert-admin.util';
import { PageAccessService } from './page-access.service';
import { PagesService } from './pages.service';
import { WorkspacesService } from './workspaces.service';
import { isSystemAdmin } from './pages.shared';
import { hashPassword, verifyPassword } from './password.util';
import { loginLookup, normalizeUsername } from './username.util';

// Users: login, profiles and preferences, password changes, and admin user management.
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PageAccessService,
    private readonly pages: PagesService,
    private readonly workspaces: WorkspacesService,
  ) {}

  private sanitizeUserPreferences(payload: any) {
    const prefs: Record<string, any> = {};
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      if (typeof payload.sidebarHidden === 'boolean') prefs.sidebarHidden = payload.sidebarHidden;
      if (typeof payload.hideAi === 'boolean') prefs.hideAi = payload.hideAi;
    }
    return prefs;
  }

  private stripPassword<T extends { passwordHash?: string | null }>(user: T): Omit<T, 'passwordHash'> {
    const { passwordHash: _pw, ...rest } = user;
    return rest;
  }

  // `login` is an email address or a username.
  async loginWithCredentials(login: string, password: string) {
    if (!login?.trim() || !password) {
      throw new BadRequestException('Email or username and password are required');
    }
    const user = await this.prisma.user.findUnique({ where: loginLookup(login) });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email, username or password');
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email, username or password');
    }
    return { user: this.stripPassword(user) };
  }

  async getUserProfile(id: string, user?: { userId?: string; userName?: string }) {
    if (!user?.userId) {
      throw new BadRequestException('userId is required');
    }
    if (user.userId !== id && !isSystemAdmin(user.userId)) {
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
      throw new BadRequestException('userId is required');
    }
    if (user.userId !== id) {
      throw new ForbiddenException('Forbidden: user access required');
    }
    const nextPrefs = this.sanitizeUserPreferences(payload);
    const existing = await this.prisma.user.findUnique({ where: { id }, select: { preferences: true } });
    if (!existing) {
      throw new NotFoundException('User not found');
    }
    const current =
      existing.preferences && typeof existing.preferences === 'object' && !Array.isArray(existing.preferences)
        ? (existing.preferences as Record<string, any>)
        : {};
    const merged = { ...current, ...nextPrefs };
    const updated = await this.prisma.user.update({
      where: { id },
      data: { preferences: merged },
    });
    return this.stripPassword(updated);
  }

  async listUsers(adminId?: string) {
    assertSystemAdmin(adminId);
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.stripPassword(u));
  }

  async adminCreateUser(
    adminId: string,
    payload: { displayName: string; email: string; password: string; username?: string; mustChangePassword?: boolean },
  ) {
    assertSystemAdmin(adminId);
    const { displayName, email, password } = payload;
    if (!displayName?.trim()) throw new BadRequestException('displayName is required');
    if (!email?.trim()) throw new BadRequestException('email is required');
    if (!password) throw new BadRequestException('password is required');
    const username = normalizeUsername(payload.username) || null;
    const existing = await this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) throw new BadRequestException('A user with that email already exists');
    await this.assertUsernameFree(username);
    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({
      data: {
        email: email.toLowerCase().trim(),
        displayName: displayName.trim(),
        username,
        passwordHash,
        mustChangePassword: payload.mustChangePassword !== false,
      },
    });
    await this.access.ensureDefaultWorkspaces(user.id, user.displayName);
    return this.stripPassword(user);
  }

  async adminUpdateUser(adminId: string, userId: string, payload: { displayName?: string; email?: string; username?: string | null }) {
    assertSystemAdmin(adminId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const data: { displayName?: string; email?: string; username?: string | null } = {};
    const username = normalizeUsername(payload.username);
    if (username !== undefined) {
      await this.assertUsernameFree(username, userId);
      data.username = username;
    }
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

  private async assertUsernameFree(username: string | null | undefined, exceptUserId?: string) {
    if (!username) return;
    const clash = await this.prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (clash && clash.id !== exceptUserId) throw new BadRequestException('That username is taken');
  }

  async adminResetPassword(adminId: string, userId: string, newPassword: string, mustChangePassword = true) {
    assertSystemAdmin(adminId);
    if (!newPassword) throw new BadRequestException('newPassword is required');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: mustChangePassword !== false } });
    return { ok: true };
  }

  async adminDeleteUser(adminId: string, userId: string) {
    assertSystemAdmin(adminId);
    if (userId === SYSTEM_ADMIN_ID) throw new BadRequestException('Cannot delete the system admin');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Don't leave a shared workspace without an owner.
    const ownedShared = await this.prisma.userWorkspace.findMany({
      where: { userId, role: WorkspaceRole.OWNER, workspace: { personalOwnerId: null } },
      select: { workspaceId: true, workspace: { select: { name: true } } },
    });
    const soleOwnerOf: string[] = [];
    for (const membership of ownedShared) {
      const owners = await this.prisma.userWorkspace.count({
        where: { workspaceId: membership.workspaceId, role: WorkspaceRole.OWNER },
      });
      if (owners <= 1) soleOwnerOf.push(membership.workspace.name);
    }
    if (soleOwnerOf.length) {
      throw new ConflictException(
        `${user.displayName} is the only owner of ${soleOwnerOf.join(', ')}. Make someone else an owner first.`
      );
    }

    // Their personal workspace goes, and so do their private pages elsewhere, which nobody
    // else could open. Their public pages stay, without an author.
    const personal = await this.prisma.workspace.findFirst({ where: { personalOwnerId: userId }, select: { id: true } });
    const privatePages = await this.prisma.page.findMany({
      where: { authorId: userId, visibility: PageVisibility.PRIVATE, ...(personal ? { NOT: { workspaceId: personal.id } } : {}) },
      select: { id: true },
    });
    const privateIds = new Set<string>();
    for (const page of privatePages) {
      privateIds.add(page.id);
      for (const id of await this.access.collectDescendantIds(page.id)) privateIds.add(id);
    }
    await this.prisma.$transaction(async (tx) => {
      if (personal) await this.workspaces.removeWorkspace(tx, personal.id);
      await this.pages.removePages(tx, [...privateIds]);
      await tx.page.updateMany({ where: { authorId: userId }, data: { authorId: null } });
      await tx.userWorkspace.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    return { ok: true };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new NotFoundException('User not found');
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    // Not 401: the web app treats 401 as an expired session and logs the user out.
    if (!valid) throw new BadRequestException('Current password is incorrect');
    if (newPassword === currentPassword) throw new BadRequestException('Choose a password different from the current one');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });
    return { ok: true };
  }
}
