import { lookup } from 'node:dns/promises';
import { AppError, type ErrorCode } from '../errors.js';

/** Image/video import: bad syntax is validation, blocked targets and DNS failures keep their own codes. */
export const IMPORT_URL_CODES = {
  invalid: 'VALIDATION_ERROR',
  blocked: 'ASSET_IMPORT_BLOCKED',
  lookupFailed: 'ASSET_IMPORT_FAILED',
} as const satisfies PublicUrlCodes;

/** Saving an LLM/OCR baseUrl: every failure is a client validation error, including DNS. */
export const SAVED_ENDPOINT_CODES = {
  invalid: 'VALIDATION_ERROR',
  blocked: 'VALIDATION_ERROR',
  lookupFailed: 'VALIDATION_ERROR',
} as const satisfies PublicUrlCodes;

/** Calling a stored endpoint: do not surface resolver text; DNS failure is an upstream outage. */
export const REQUEST_ENDPOINT_CODES = {
  invalid: 'VALIDATION_ERROR',
  blocked: 'VALIDATION_ERROR',
  lookupFailed: 'LLM_UNAVAILABLE',
} as const satisfies PublicUrlCodes;

export interface PublicUrlCodes {
  invalid: ErrorCode;
  blocked: ErrorCode;
  lookupFailed: ErrorCode;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type PublicLookup = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const BLOCKED_HOSTS = new Set(['localhost', 'metadata.google.internal']);

export function isBlockedHostname(host: string): boolean {
  const normalized = normalizeHostname(host);
  if (!normalized) return true;
  if (BLOCKED_HOSTS.has(normalized)) return true;
  if (normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  return false;
}

/**
 * Private, loopback, link-local, metadata, unspecified, multicast, and reserved 240/4.
 * IPv4-mapped (and other embedded-IPv4) addresses are judged by the inner IPv4.
 */
export function isBlockedIp(ip: string): boolean {
  const bare = stripZone(stripIpv6Brackets(ip.trim()));
  if (!bare) return true;
  if (bare.includes(':')) return isBlockedIpv6(bare);
  return isBlockedIpv4(bare);
}

/**
 * Syntax and literal checks only. WHATWG URL folds decimal, hex, octal, and short
 * IPv4 forms into a canonical address, so the host as written is checked first.
 */
export function assertPublicHttpUrl(raw: string, codes: PublicUrlCodes = IMPORT_URL_CODES): URL {
  const written = rawHostOf(raw);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw AppError.of(400, codes.invalid);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw AppError.of(400, codes.invalid);
  }
  if (parsed.username || parsed.password) throw AppError.of(400, codes.blocked);
  if (written && isObfuscatedIpLiteral(written)) throw AppError.of(400, codes.blocked);
  if (isBlockedHostname(parsed.hostname)) throw AppError.of(400, codes.blocked);
  const normalized = normalizeHostname(parsed.hostname);
  if (isIpLiteralHost(normalized) && isBlockedIp(normalized)) {
    throw AppError.of(400, codes.blocked);
  }
  return parsed;
}

/** Empty / null means "use the default endpoint" and is not looked up. */
export async function assertOptionalPublicBaseUrl(
  baseUrl: string | null | undefined,
  codes: PublicUrlCodes,
  lookupFn?: PublicLookup,
): Promise<void> {
  if (baseUrl == null) return;
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) return;
  const url = assertPublicHttpUrl(trimmed, codes);
  await assertResolvedPublic(url.hostname, { codes, ...(lookupFn ? { lookup: lookupFn } : {}) });
}

export async function assertResolvedPublic(
  hostname: string,
  options?: { lookup?: PublicLookup; codes?: PublicUrlCodes },
): Promise<readonly ResolvedAddress[]> {
  const codes = options?.codes ?? IMPORT_URL_CODES;
  const host = normalizeHostname(hostname);
  if (!host || isBlockedHostname(host) || isObfuscatedIpLiteral(host)) {
    throw AppError.of(400, codes.blocked);
  }
  if (isIpLiteralHost(host) && isBlockedIp(host)) throw AppError.of(400, codes.blocked);
  const resolve = options?.lookup ?? defaultLookup;
  let records: readonly ResolvedAddress[];
  try {
    records = await resolve(host);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw AppError.of(400, codes.lookupFailed);
  }
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw AppError.of(400, codes.blocked);
  }
  return records;
}

/** Follow `location` (absolute, protocol-relative, or relative) and re-apply literal checks. */
export function resolvePublicRedirect(location: string, current: URL, codes: PublicUrlCodes = IMPORT_URL_CODES): URL {
  const written = rawHostOf(location);
  if (written && isObfuscatedIpLiteral(written)) throw AppError.of(400, codes.blocked);
  let resolved: URL;
  try {
    resolved = new URL(location, current);
  } catch {
    throw AppError.of(400, codes.invalid);
  }
  return assertPublicHttpUrl(resolved.href, codes);
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => ({ address: record.address, family: record.family }));
}

function normalizeHostname(host: string): string {
  return stripIpv6Brackets(host.trim()).toLowerCase().replace(/\.$/, '');
}

/** Host as written on an absolute or protocol-relative URL, before WHATWG IP normalization. */
function rawHostOf(input: string): string | null {
  const trimmed = input.trim();
  let rest: string;
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed);
  if (absolute) {
    rest = trimmed.slice(absolute[0].length);
  } else if (trimmed.startsWith('//')) {
    rest = trimmed.slice(2);
  } else {
    return null;
  }
  const cut = rest.search(/[/?#]/);
  let authority = cut === -1 ? rest : rest.slice(0, cut);
  const at = authority.lastIndexOf('@');
  if (at !== -1) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    if (end === -1) return null;
    return authority.slice(1, end);
  }
  const colon = authority.lastIndexOf(':');
  if (colon !== -1) authority = authority.slice(0, colon);
  return authority;
}

function isObfuscatedIpLiteral(host: string): boolean {
  const bare = host.trim().replace(/\.$/, '');
  if (!bare || bare.includes(':')) return false;
  if (/^\d+$/.test(bare) || /^0x[0-9a-f]+$/i.test(bare)) return true;
  if (!bare.includes('.')) return false;
  const parts = bare.split('.');
  if (parts.some((part) => part.length === 0)) return false;
  const numeric = parts.every((part) => /^\d+$/.test(part) || /^0x[0-9a-f]+$/i.test(part));
  if (!numeric) return false;
  if (parts.some((part) => /^0x[0-9a-f]+$/i.test(part))) return true;
  return !isCanonicalIpv4(bare);
}

function isIpLiteralHost(host: string): boolean {
  return host.includes(':') || isCanonicalIpv4(host);
}

function isCanonicalIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function stripIpv6Brackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function stripZone(ip: string): string {
  const zone = ip.indexOf('%');
  return zone === -1 ? ip : ip.slice(0, zone);
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return true;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return true;
    const value = Number(part);
    if (!Number.isInteger(value) || value > 255) return true;
    nums.push(value);
  }
  const a = nums[0];
  const b = nums[1];
  if (a === undefined || b === undefined) return true;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const groups = parseIpv6(ip);
  if (!groups) return true;
  const embedded = embeddedIpv4(groups);
  // :: and ::1 fall out as 0.0.0.0 / 0.0.0.1 via the IPv4-compatible form.
  if (embedded) return isBlockedIpv4(embedded);
  const first = groups[0];
  if (first === undefined) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xff00) === 0xff00) return true;
  return false;
}

function embeddedIpv4(groups: readonly number[]): string | null {
  const hi = groups[6];
  const lo = groups[7];
  if (hi === undefined || lo === undefined) return null;
  const head = groups.slice(0, 6);
  if (head.slice(0, 5).every((group) => group === 0) && head[5] === 0xffff) {
    return ipv4FromHextets(hi, lo);
  }
  if (head.every((group) => group === 0)) return ipv4FromHextets(hi, lo);
  if (groups[0] === 0x2002 && groups[1] !== undefined && groups[2] !== undefined) {
    return ipv4FromHextets(groups[1], groups[2]);
  }
  if (
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return ipv4FromHextets(hi, lo);
  }
  return null;
}

function ipv4FromHextets(hi: number, lo: number): string {
  return `${(hi >>> 8) & 0xff}.${hi & 0xff}.${(lo >>> 8) & 0xff}.${lo & 0xff}`;
}

function parseIpv6(ip: string): number[] | null {
  let text = ip.trim().toLowerCase();
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    if (lastColon === -1) return null;
    const octets = text.slice(lastColon + 1).split('.');
    if (octets.length !== 4 || !isCanonicalIpv4(octets.join('.'))) return null;
    const nums = octets.map((part) => Number(part));
    const hi = ((nums[0] ?? 0) << 8) | (nums[1] ?? 0);
    const lo = ((nums[2] ?? 0) << 8) | (nums[3] ?? 0);
    text = `${text.slice(0, lastColon)}:${hi.toString(16)}:${lo.toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const expand = (part: string): string[] => (part.length === 0 ? [] : part.split(':'));
  const left = expand(halves[0] ?? '');
  const right = halves.length === 2 ? expand(halves[1] ?? '') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length > 8) return null;
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (groups.length !== 8) return null;
  const nums: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    nums.push(Number.parseInt(group, 16));
  }
  return nums;
}
