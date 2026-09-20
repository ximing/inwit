import { OPEN_MEDIA_REHOST_MAX } from '@inwit/dto';
import type { PmJson } from '@inwit/doc-schema';
import { isAssetSrc, isHttpSrc } from '../assets/asset-logic.js';
import { AppError } from '../errors.js';

export { OPEN_MEDIA_REHOST_MAX };

/** Fixed-window per-token rate limit for the open API (digest jobs cost LLM tokens). */
const OPEN_RATE_LIMIT_MAX = 30;
const OPEN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const hits = new Map<string, number[]>();

export function checkOpenTokenRate(tokenId: string, now: number = Date.now()): void {
  const windowStart = now - OPEN_RATE_LIMIT_WINDOW_MS;
  const recent = (hits.get(tokenId) ?? []).filter((ts) => ts > windowStart);
  if (recent.length >= OPEN_RATE_LIMIT_MAX) {
    throw AppError.of(429, 'RATE_LIMITED');
  }
  recent.push(now);
  hits.set(tokenId, recent);
}

/** Test hook: drop all recorded hits. */
export function resetOpenTokenRate(): void {
  hits.clear();
}

/** Prepend a source attribution line when the article has a known origin URL. */
export function buildFinalMarkdown(markdown: string, sourceUrl?: string): string {
  if (!sourceUrl) return markdown;
  // Angle-bracket destination survives spaces/parens in the URL.
  return `> 原文：[原文链接](<${sourceUrl}>)\n\n${markdown}`;
}

function considerHttpSrc(value: unknown, seen: Set<string>, out: string[]): void {
  if (typeof value !== 'string') return;
  if (isAssetSrc(value) || !isHttpSrc(value)) return;
  if (seen.has(value)) return;
  seen.add(value);
  out.push(value);
}

/** Unique http(s) image/video srcs (and posters), in document order. */
export function collectHttpMediaSrcs(doc: PmJson): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (node: PmJson): void => {
    if (node.type === 'image' || node.type === 'video') {
      considerHttpSrc(node.attrs?.src, seen, out);
      considerHttpSrc(node.attrs?.poster, seen, out);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return out;
}

export function partitionRehostSrcs(srcs: readonly string[]): { toRehost: string[]; skipped: string[] } {
  if (srcs.length <= OPEN_MEDIA_REHOST_MAX) return { toRehost: [...srcs], skipped: [] };
  return {
    toRehost: srcs.slice(0, OPEN_MEDIA_REHOST_MAX),
    skipped: srcs.slice(OPEN_MEDIA_REHOST_MAX),
  };
}

function rewriteAttr(
  attrs: Record<string, unknown> | undefined,
  key: string,
  rewrites: ReadonlyMap<string, string>,
): Record<string, unknown> | undefined {
  const current = attrs?.[key];
  if (typeof current !== 'string' || !rewrites.has(current)) return attrs;
  return { ...attrs, [key]: rewrites.get(current) };
}

/** Replace matching image/video src and poster strings. Unmatched nodes stay as-is. */
export function applySrcRewrites(doc: PmJson, rewrites: ReadonlyMap<string, string>): PmJson {
  if (rewrites.size === 0) return doc;
  const walk = (node: PmJson): PmJson => {
    let attrs = node.attrs;
    if (node.type === 'image' || node.type === 'video') {
      attrs = rewriteAttr(attrs, 'src', rewrites);
      attrs = rewriteAttr(attrs, 'poster', rewrites);
    }
    let content = node.content;
    if (node.content) {
      const next = node.content.map(walk);
      const unchanged = next.every((child, index) => child === node.content![index]);
      content = unchanged ? node.content : next;
    }
    if (attrs === node.attrs && content === node.content) return node;
    return {
      ...node,
      ...(attrs !== node.attrs ? { attrs } : {}),
      ...(content !== node.content ? { content } : {}),
    };
  };
  return walk(doc);
}
