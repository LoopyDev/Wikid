import { BadRequestException } from '@nestjs/common';

// Usernames: an optional, unique name to log in with instead of the email address. Stored in
// lower case; no "@", so a login is an email exactly when it contains one.
const USERNAME_PATTERN = /^[a-z0-9._-]{2,32}$/;

/** undefined when not given, null to clear it, otherwise the normalized username (or a 400). */
export function normalizeUsername(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  if (!USERNAME_PATTERN.test(value)) {
    throw new BadRequestException('A username is 2 to 32 letters, numbers, dots, dashes or underscores');
  }
  return value;
}

/** Where to look up a login: by email if it contains "@", otherwise by username. */
export function loginLookup(login: string): { email: string } | { username: string } {
  const value = login.trim().toLowerCase();
  return value.includes('@') ? { email: value } : { username: value };
}
