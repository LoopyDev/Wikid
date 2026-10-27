import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ALLOW_PENDING_PASSWORD_KEY, IS_PUBLIC_KEY } from './public.decorator';
import { SESSION_COOKIE, readCookie, verifySession } from './session.util';

export type AuthUser = { id: string; displayName: string; email: string | null };

type AuthedRequest = Request & { authUser?: AuthUser };

/**
 * Global guard: every route requires a valid session cookie unless marked @Public().
 *
 * It puts the session user on the request; routes read it with the decorators below, never from
 * what the client sends, so the service-layer permission checks act on the real identity.
 *
 * A user whose password an admin set must choose their own before doing anything else; until
 * then only routes marked @AllowPendingPasswordChange() are open to them.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const userId = token ? verifySession(token) : null;
    if (!userId) throw new UnauthorizedException('Not logged in');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, email: true, mustChangePassword: true },
    });
    if (!user) throw new UnauthorizedException('Not logged in');
    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [context.getHandler(), context.getClass()]);
    if (user.mustChangePassword && !allowPending) {
      throw new ForbiddenException({ message: 'Choose a new password first', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    req.authUser = { id: user.id, displayName: user.displayName, email: user.email };
    return true;
  }
}

/** The logged-in user, as resolved by SessionGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  return context.switchToHttp().getRequest<AuthedRequest>().authUser as AuthUser;
});

/** The logged-in user's id. Routes take who's acting from here, never from the request. */
export const CurrentUserId = createParamDecorator((_data: unknown, context: ExecutionContext): string | undefined => {
  return context.switchToHttp().getRequest<AuthedRequest>().authUser?.id;
});

/** The logged-in user's display name, for "last edited by" and similar. */
export const CurrentUserName = createParamDecorator((_data: unknown, context: ExecutionContext): string | undefined => {
  return context.switchToHttp().getRequest<AuthedRequest>().authUser?.displayName;
});

/**
 * The logged-in user's id when the request asks to act as an admin (it sends `adminId`, in the query
 * or the body), otherwise undefined. The services check that the user really is an admin.
 */
export const AdminId = createParamDecorator((_data: unknown, context: ExecutionContext): string | undefined => {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  const asksForAdmin =
    (req.query && typeof req.query === 'object' && 'adminId' in req.query) ||
    (req.body && typeof req.body === 'object' && 'adminId' in req.body);
  return asksForAdmin ? req.authUser?.id : undefined;
});
