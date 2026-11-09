import { ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

/** The collab server's calls to the API carry the shared COLLAB_API_SECRET as a bearer token. */
export function assertCollabSecret(authHeader?: string) {
  const secret = process.env.COLLAB_API_SECRET;
  if (!secret) {
    throw new ForbiddenException('Collab API secret not configured');
  }
  const token = Buffer.from((authHeader || '').replace(/^Bearer\s+/i, '').trim());
  const expected = Buffer.from(secret);
  // Compared in constant time, so response times don't give the secret away
  if (!token.length || token.length !== expected.length || !timingSafeEqual(token, expected)) {
    throw new ForbiddenException('Invalid collab API secret');
  }
}
