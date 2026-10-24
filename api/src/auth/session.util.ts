import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';

export const SESSION_COOKIE = 'wikid_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days

let devSecret: string | null = null;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET must be set in production');
  }
  if (!devSecret) {
    devSecret = randomBytes(32).toString('hex');
    // eslint-disable-next-line no-console
    console.warn('SESSION_SECRET is not set; using a random secret. Sessions will reset when the API restarts.');
  }
  return devSecret;
}

export function signSession(userId: string): string {
  return jwt.sign({ sub: userId }, getSessionSecret(), { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySession(token: string): string | null {
  try {
    const payload = jwt.verify(token, getSessionSecret());
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  // SESSION_COOKIE_SECURE=false allows plain-HTTP installs (e.g. the Docker setup on localhost)
  secure: process.env.SESSION_COOKIE_SECURE ? process.env.SESSION_COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_TTL_SECONDS * 1000,
});
