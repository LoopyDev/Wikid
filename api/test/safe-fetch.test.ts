import { describe, expect, it } from 'vitest';
import { isBlockedAddress, parsePublicUrl, safeFetch } from '../src/utils/safe-fetch.util';

describe('fetching addresses people give us', () => {
  it('refuses private, local and reserved addresses', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.17.0.2', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1',
      'not-an-ip',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['93.184.215.14', '1.1.1.1', '2606:4700:4700::1111', '::ffff:93.184.215.14']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('refuses URLs that are not http(s), carry a login, or name a private IP', () => {
    expect(() => parsePublicUrl('file:///etc/passwd')).toThrow(/http and https/);
    expect(() => parsePublicUrl('ftp://example.com/x')).toThrow(/http and https/);
    expect(() => parsePublicUrl('http://user:pass@example.com/')).toThrow(/can't be fetched/);
    expect(() => parsePublicUrl('http://127.0.0.1:3000/')).toThrow(/can't be fetched/);
    expect(() => parsePublicUrl('http://[::1]/')).toThrow(/can't be fetched/);
    expect(() => parsePublicUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/can't be fetched/);
    expect(parsePublicUrl('https://example.com/a?b=c').hostname).toBe('example.com');
  });

  it('refuses names that resolve to private addresses, at connection time', async () => {
    await expect(safeFetch('http://localhost:8080/', { maxBytes: 1000, timeoutMs: 3000 })).rejects.toThrow(/can't be fetched/);
  });
});
