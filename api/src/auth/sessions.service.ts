import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_SECONDS, signSession } from './session.util';

/**
 * Signed-in sessions. Each is a row whose id is in the cookie, so it can be ended before the cookie
 * runs out: logging out ends it, changing a password ends the others, a reset ends them all.
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** A new session for someone: its id and the cookie's value. */
  async start(userId: string, ttlSeconds = SESSION_TTL_SECONDS) {
    // Sessions that have run out go now (anyone's: someone who never signs in again leaves theirs)
    await this.prisma.userSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const session = await this.prisma.userSession.create({
      data: { userId, expiresAt: new Date(Date.now() + ttlSeconds * 1000) },
      select: { id: true },
    });
    return { id: session.id, token: signSession(userId, session.id, ttlSeconds) };
  }

  async end(sessionId: string) {
    await this.prisma.userSession.deleteMany({ where: { id: sessionId } });
  }

  /** Ends someone's sessions, but for the one given (the one they're using). */
  async endAllFor(userId: string, exceptSessionId?: string) {
    await this.prisma.userSession.deleteMany({ where: { userId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) } });
  }
}
