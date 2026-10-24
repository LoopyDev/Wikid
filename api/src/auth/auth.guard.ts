import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SESSION_COOKIE, readCookie, verifySession } from './session.util';

export type AuthUser = { id: string; displayName: string; email: string | null };

type AuthedRequest = Request & { authUser?: AuthUser };

/**
 * Global guard: every route requires a valid session cookie unless marked @Public().
 *
 * Existing handlers read the acting user from `userId` / `userName` / `adminId` params. Rather
 * than trusting what the client sends, the guard overwrites those params with the session user,
 * so the service-layer permission checks act on the real identity.
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
      select: { id: true, displayName: true, email: true },
    });
    if (!user) throw new UnauthorizedException('Not logged in');

    req.authUser = user;
    const query = req.query as Record<string, unknown>;
    query.userId = user.id;
    query.userName = user.displayName;
    if ('adminId' in query) query.adminId = user.id;
    if (req.body && typeof req.body === 'object' && 'adminId' in req.body) {
      req.body.adminId = user.id;
    }
    return true;
  }
}

/** The logged-in user, as resolved by SessionGuard. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  return context.switchToHttp().getRequest<AuthedRequest>().authUser as AuthUser;
});
