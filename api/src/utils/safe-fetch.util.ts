import { BadRequestException } from '@nestjs/common';
import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent, fetch, type Response } from 'undici';

/**
 * Fetching addresses that people type in (link previews, "image from URL") without letting them reach
 * Wikid's own network: the database, storage and collab containers, the host, or a cloud metadata
 * service. Every address is checked where it's connected to, so a hostname can't resolve to a private
 * IP after a check, and redirects are followed by hand so each hop is checked too.
 */

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata (169.254.169.254)
  ['172.16.0.0', 12], // private (Docker's networks are in here)
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64, which can map to private IPv4
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** True for addresses on private, local or reserved networks, which Wikid shouldn't fetch from. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as the IPv4 address
    const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(address, 'ipv6');
  }
  return true; // not an IP address at all: refuse rather than guess
}

const refused = () => new BadRequestException("That address can't be fetched");

// Looks names up as usual, then refuses if any address is private, local or reserved
const checkedLookup = (
  hostname: string,
  options: object,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((entry) => isBlockedAddress(entry.address))) {
      const error: NodeJS.ErrnoException = new Error(`Refused to connect to ${hostname}`);
      error.code = 'EBLOCKEDADDRESS';
      return callback(error, []);
    }
    if ((options as { all?: boolean }).all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

const agent = new Agent({ connect: { lookup: checkedLookup as never } });

/** Parses and checks an address someone gave us: http or https, and not a private IP written out. */
export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only http and https addresses are allowed');
  }
  if (url.username || url.password) throw refused();
  // Addresses written as IPs skip the lookup above, so check them here
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host)) throw refused();
  return url;
}

export type SafeFetchResult = { url: URL; response: Response; body: Buffer };

/**
 * Fetches a public address, following up to 5 redirects (each one checked), with a time limit and a
 * size limit. Errors are kept vague on purpose, so this can't be used to map Wikid's network.
 */
export async function safeFetch(
  raw: string,
  { maxBytes, timeoutMs = 10_000, headers = {} }: { maxBytes: number; timeoutMs?: number; headers?: Record<string, string> },
): Promise<SafeFetchResult> {
  const signal = AbortSignal.timeout(timeoutMs);
  let url = parsePublicUrl(raw);
  for (let hop = 0; hop <= 5; hop += 1) {
    let response: Response;
    try {
      response = await fetch(url, { dispatcher: agent, redirect: 'manual', signal, headers });
    } catch (err) {
      const code = (err as { cause?: { code?: string } })?.cause?.code;
      if (code === 'EBLOCKEDADDRESS') throw refused();
      throw new BadRequestException("Couldn't fetch that address");
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel();
      url = parsePublicUrl(new URL(response.headers.get('location') as string, url).toString());
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new BadRequestException("Couldn't fetch that address");
    }
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) {
      await response.body?.cancel();
      throw new BadRequestException('That file is too large');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.body ?? []) {
      total += chunk.length;
      if (total > maxBytes) throw new BadRequestException('That file is too large');
      chunks.push(Buffer.from(chunk));
    }
    return { url, response, body: Buffer.concat(chunks) };
  }
  throw new BadRequestException('Too many redirects');
}
