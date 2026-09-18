import { AppError } from '../errors.js';

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
