import { ASSET_RESOLVE_MAX_SRCS } from '@inwit/dto';
import {
  isPresignedStale,
  livePresignedUrl,
  shouldRetryPresign,
  type PresignedUrlEntry,
} from './presign-cache-logic';

/** Matches markdown `safeMediaSrc` / server `asset:` destinations. */
const ASSET_SRC_RE =
  /^asset:users\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\/doc-assets\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[a-zA-Z0-9]{1,16}$/;

export type AssetUrlEntry = PresignedUrlEntry;
export type AssetUrlCache = Record<string, AssetUrlEntry>;

export function isAssetSrc(src: string): boolean {
  return ASSET_SRC_RE.test(src);
}

export function isHttpSrc(src: string): boolean {
  try {
    const parsed = new URL(src);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function uniqueSrcs(srcs: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const src of srcs) {
    if (src === '' || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

/**
 * Src values that should be POSTed to `/api/assets/resolve`.
 * http(s) pass through on the client; fresh cache hits are skipped.
 * Failed entries (`url === ''`) use the short retry cooldown.
 */
export function srcsNeedingResolve(
  srcs: readonly string[],
  cache: Readonly<AssetUrlCache>,
  now = Date.now(),
): string[] {
  const out: string[] = [];
  for (const src of uniqueSrcs(srcs)) {
    if (!isAssetSrc(src)) continue;
    const entry = cache[src];
    if (!entry) {
      out.push(src);
      continue;
    }
    if (entry.url.length > 0) {
      if (isPresignedStale(entry, now)) out.push(src);
      continue;
    }
    if (shouldRetryPresign(entry, now)) out.push(src);
  }
  return out;
}

export function partitionInFlight(
  needed: readonly string[],
  inFlight: ReadonlySet<string>,
): { toFetch: string[]; waiting: string[] } {
  const toFetch: string[] = [];
  const waiting: string[] = [];
  const seen = new Set<string>();
  for (const src of needed) {
    if (src === '' || seen.has(src)) continue;
    seen.add(src);
    if (inFlight.has(src)) waiting.push(src);
    else toFetch.push(src);
  }
  return { toFetch, waiting };
}

export function addInFlight(inFlight: ReadonlySet<string>, srcs: readonly string[]): Set<string> {
  const next = new Set(inFlight);
  for (const src of srcs) {
    if (src !== '') next.add(src);
  }
  return next;
}

export function removeInFlight(
  inFlight: ReadonlySet<string>,
  srcs: readonly string[],
): Set<string> {
  const next = new Set(inFlight);
  for (const src of srcs) next.delete(src);
  return next;
}

export function mergeResolvedUrls(
  cache: Readonly<AssetUrlCache>,
  urls: Readonly<Record<string, string>>,
  fetchedAt: number,
): AssetUrlCache {
  const next: AssetUrlCache = { ...cache };
  for (const [src, url] of Object.entries(urls)) {
    if (url.length === 0) continue;
    next[src] = { url, fetchedAt };
  }
  return next;
}

export function markResolveFailure(
  cache: Readonly<AssetUrlCache>,
  srcs: readonly string[],
  fetchedAt: number,
): AssetUrlCache {
  const next: AssetUrlCache = { ...cache };
  for (const src of srcs) {
    next[src] = { url: '', fetchedAt };
  }
  return next;
}

export function liveAssetUrl(
  src: string,
  cache: Readonly<AssetUrlCache>,
  now = Date.now(),
): string | null {
  if (isHttpSrc(src)) return src;
  if (!isAssetSrc(src)) return null;
  const url = livePresignedUrl(cache[src], now);
  return url ? url : null;
}

export function chunkSrcs(
  srcs: readonly string[],
  size = ASSET_RESOLVE_MAX_SRCS,
): string[][] {
  if (srcs.length === 0) return [];
  const chunkSize = size > 0 ? size : srcs.length;
  const out: string[][] = [];
  for (let i = 0; i < srcs.length; i += chunkSize) {
    out.push(srcs.slice(i, i + chunkSize));
  }
  return out;
}
