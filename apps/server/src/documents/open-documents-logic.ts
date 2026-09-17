import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
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

let turndown: TurndownService | undefined;

function turndownService(): TurndownService {
  if (!turndown) {
    turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
    });
    turndown.use(gfm);
    // Drop scripts/styles and non-content elements instead of emitting their text.
    turndown.remove(['script', 'style', 'noscript', 'iframe', 'button', 'form', 'input', 'select', 'textarea']);
  }
  return turndown;
}

/** Article HTML → GFM markdown. Images are kept as `![alt](src)`. */
export function htmlToMarkdownViaTurndown(html: string): string {
  const md = turndownService().turndown(html).trim();
  if (md.length === 0) throw AppError.of(400, 'IMPORT_EMPTY');
  return md;
}

/** Prepend a source attribution line when the article has a known origin URL. */
export function buildFinalMarkdown(markdown: string, sourceUrl?: string): string {
  if (!sourceUrl) return markdown;
  // Angle-bracket destination survives spaces/parens in the URL.
  return `> 原文：[原文链接](<${sourceUrl}>)\n\n${markdown}`;
}
