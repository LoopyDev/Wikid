import { describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { LOGIN_LIMITS, LoginRateLimiter } from '../src/auth/login-rate-limiter';

const MINUTE = 60 * 1000;

/** The status and Retry-After seconds check() throws, or null if it lets the login through. */
function blockedFor(limiter: LoginRateLimiter, login: string, address: string, now: number) {
  try {
    limiter.check(login, address, now);
    return null;
  } catch (err) {
    const res = (err as HttpException).getResponse() as { retryAfter: number };
    return { status: (err as HttpException).getStatus(), retryAfter: res.retryAfter };
  }
}

describe('login rate limiter', () => {
  it('blocks an account from one address after 5 failures, until the oldest is 15 minutes old', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_LIMITS.accountAndAddress; i += 1) {
      expect(blockedFor(limiter, 'alice', '1.1.1.1', i * MINUTE)).toBeNull();
      limiter.recordFailure('alice', '1.1.1.1', i * MINUTE);
    }
    // The 5th failure was at minute 4; the first, at 0, expires at minute 15.
    expect(blockedFor(limiter, 'alice', '1.1.1.1', 5 * MINUTE)).toEqual({ status: 429, retryAfter: 10 * 60 });
    expect(blockedFor(limiter, 'ALICE ', '1.1.1.1', 5 * MINUTE)).not.toBeNull();
    expect(blockedFor(limiter, 'alice', '2.2.2.2', 5 * MINUTE)).toBeNull();
    expect(blockedFor(limiter, 'bob', '1.1.1.1', 5 * MINUTE)).toBeNull();
    expect(blockedFor(limiter, 'alice', '1.1.1.1', 15 * MINUTE)).toBeNull();
  });

  it('a successful login clears the count for that account and address', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_LIMITS.accountAndAddress - 1; i += 1) limiter.recordFailure('alice', '1.1.1.1', 0);
    limiter.recordSuccess('alice', '1.1.1.1');
    limiter.recordFailure('alice', '1.1.1.1', 0);
    expect(blockedFor(limiter, 'alice', '1.1.1.1', 0)).toBeNull();
  });

  it('blocks an account from anywhere after 20 failures, and an address after 100', () => {
    const limiter = new LoginRateLimiter();
    for (let i = 0; i < LOGIN_LIMITS.account; i += 1) limiter.recordFailure('alice', `10.0.0.${i}`, 0);
    expect(blockedFor(limiter, 'alice', '10.0.1.1', 0)?.status).toBe(429);

    for (let i = 0; i < LOGIN_LIMITS.address; i += 1) limiter.recordFailure(`user${i}`, '9.9.9.9', 0);
    expect(blockedFor(limiter, 'someone-new', '9.9.9.9', 0)?.status).toBe(429);
    expect(blockedFor(limiter, 'someone-new', '8.8.8.8', 0)).toBeNull();
  });
});
