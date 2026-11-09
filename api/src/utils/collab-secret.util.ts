import { ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** Whether a request carries the shared COLLAB_API_SECRET (the collab server's calls to the API). */
export function isCollabSecret(authHeader?: string | string[]) {
  const secret = process.env.COLLAB_API_SECRET;
  if (!secret || typeof authHeader !== 'string') return false;
  const token = Buffer.from(authHeader.replace(/^Bearer\s+/i, '').trim());
  const expected = Buffer.from(secret);
  // Compared in constant time, so response times don't give the secret away
  return token.length > 0 && token.length === expected.length && timingSafeEqual(token, expected);
}

export function assertCollabSecret(authHeader?: string) {
  if (!process.env.COLLAB_API_SECRET) {
    throw new ForbiddenException('Collab API secret not configured');
  }
  if (!isCollabSecret(authHeader)) {
    throw new ForbiddenException('Invalid collab API secret');
  }
}
