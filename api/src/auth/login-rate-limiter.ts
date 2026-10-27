import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;

/**
 * Limits failed logins, so passwords can't be guessed at speed. Counts are kept in memory (one API
 * process) and reset on restart. Three limits, each over the last 15 minutes:
 * - one account from one address: the main guard against guessing a password;
 * - one account from anywhere: slows guessing spread over many addresses, while keeping how long
 *   someone else can lock a real user out short;
 * - one address across all accounts: stops trying a common password on many accounts.
 * A successful login clears its account-and-address count.
 */
export const LOGIN_LIMITS = { accountAndAddress: 5, account: 20, address: 100 } as const;

const account = (login: string) => login.trim().toLowerCase();
const pairKey = (login: string, address: string) => `pair:${account(login)}:${address}`;
const accountKey = (login: string) => `account:${account(login)}`;
const addressKey = (address: string) => `address:${address}`;

@Injectable()
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  /** Throws 429 (with Retry-After) when any limit is reached. */
  check(login: string, address: string, now = Date.now()) {
    const waitMs = Math.max(
      this.waitFor(pairKey(login, address), LOGIN_LIMITS.accountAndAddress, now),
      this.waitFor(accountKey(login), LOGIN_LIMITS.account, now),
      this.waitFor(addressKey(address), LOGIN_LIMITS.address, now),
    );
    if (waitMs <= 0) return;
    const retryAfter = Math.ceil(waitMs / 1000);
    const minutes = Math.ceil(retryAfter / 60);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  recordFailure(login: string, address: string, now = Date.now()) {
    for (const key of [pairKey(login, address), accountKey(login), addressKey(address)]) {
      const recent = this.recent(key, now);
      recent.push(now);
      this.failures.set(key, recent);
    }
    this.sweep(now);
  }

  recordSuccess(login: string, address: string) {
    this.failures.delete(pairKey(login, address));
  }

  private recent(key: string, now: number) {
    return (this.failures.get(key) || []).filter((at) => now - at < WINDOW_MS);
  }

  /** How long until this count drops below its limit (0 if it already is). */
  private waitFor(key: string, limit: number, now: number) {
    const recent = this.recent(key, now);
    if (recent.length < limit) return 0;
    return recent[recent.length - limit] + WINDOW_MS - now;
  }

  /** Forget counts with nothing recent, now and then, so memory doesn't grow. */
  private sweep(now: number) {
    if (this.failures.size < 1000) return;
    for (const [key, times] of this.failures) {
      if (!times.some((at) => now - at < WINDOW_MS)) this.failures.delete(key);
    }
  }
}
