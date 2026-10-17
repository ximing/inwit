import type { ConceptEvidenceLocator } from '@inwit/dto';
import type { DocBlock } from '@inwit/doc-schema';
import { sha256Hex } from './concept-identity.js';

/**
 * 正文快照与引文核验的纯逻辑。块编号为 1-based 顶层块序号（与
 * doc-schema blocksFromPmJSON 一致），pageIndex 为 1-based 页码。
 */

/** 正文 hash 只覆盖块文本与块序号：标题等非正文变更不改变 hash。 */
export function documentHashFromBlocks(blocks: readonly DocBlock[]): string {
  return sha256Hex(blocks.map((block) => `${block.index}:${block.text}`).join('\n'));
}

/** Unicode code points 计数的总字符数（pageBreak 空文本不计）。 */
export function totalCharsOfBlocks(blocks: readonly DocBlock[]): number {
  let total = 0;
  for (const block of blocks) total += [...block.text].length;
  return total;
}

export interface QuoteOccurrence {
  blockIndex: number;
  pageIndex: number;
  start: number;
  end: number;
}

/** 空白容忍的子串匹配（与 doc-schema locate.ts 同一规则：压缩空白后比对）。 */
export function findQuoteInText(text: string, quote: string): { start: number; end: number }[] {
  if (quote.length === 0) return [];
  const occurrences: { start: number; end: number }[] = [];
  let from = 0;
  for (;;) {
    const index = text.indexOf(quote, from);
    if (index < 0) break;
    occurrences.push({ start: index, end: index + quote.length });
    from = index + Math.max(quote.length, 1);
  }
  if (occurrences.length > 0) return occurrences;

  const compactNeedle = quote.replace(/\s+/g, '');
  if (compactNeedle.length === 0) return [];
  const compactHay: string[] = [];
  const indexAt: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    compactHay.push(ch);
    indexAt.push(i);
  }
  const hay = compactHay.join('');
  let cursor = 0;
  for (;;) {
    const start = hay.indexOf(compactNeedle, cursor);
    if (start < 0) break;
    const fromIndex = indexAt[start];
    const toIndex = indexAt[start + compactNeedle.length - 1];
    if (fromIndex !== undefined && toIndex !== undefined) {
      occurrences.push({ start: fromIndex, end: toIndex + 1 });
    }
    cursor = start + Math.max(compactNeedle.length, 1);
  }
  return occurrences;
}

function occurrencesInBlock(block: DocBlock, quote: string): QuoteOccurrence[] {
  if (block.text.trim() === '') return [];
  return findQuoteInText(block.text, quote).map((span) => ({
    blockIndex: block.index,
    pageIndex: block.pageIndex,
    start: span.start,
    end: span.end,
  }));
}

export function findQuoteOccurrences(
  blocks: readonly DocBlock[],
  quote: string,
): QuoteOccurrence[] {
  const hits: QuoteOccurrence[] = [];
  for (const block of blocks) hits.push(...occurrencesInBlock(block, quote));
  return hits;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 前/后缀消歧：命中位置前的文本（折叠空白后）须以 prefix 结尾、后以 suffix 开头。 */
function contextMatches(
  block: DocBlock,
  occurrence: QuoteOccurrence,
  prefix: string | undefined,
  suffix: string | undefined,
): boolean {
  if (!prefix && !suffix) return true;
  const before = collapseWhitespace(block.text.slice(0, occurrence.start));
  const after = collapseWhitespace(block.text.slice(occurrence.end));
  if (prefix && !before.endsWith(collapseWhitespace(prefix))) return false;
  if (suffix && !after.startsWith(collapseWhitespace(suffix))) return false;
  return true;
}

export type EvidenceValidation =
  | { ok: true; occurrence: QuoteOccurrence }
  | { ok: false; reason: 'not_found' | 'ambiguous' };

/**
 * 在快照块集合中核验引文。重复引文无法唯一定位时返回 ambiguous，
 * 调用方必须按失效处理，不能取第一个匹配。
 */
export function validateEvidenceInBlocks(
  blocks: readonly DocBlock[],
  locator: ConceptEvidenceLocator,
): EvidenceValidation {
  const quote = locator.quote;
  switch (locator.kind) {
    case 'block': {
      const block = blocks.find((candidate) => candidate.index === locator.blockIndex);
      if (!block) return { ok: false, reason: 'not_found' };
      const hits = occurrencesInBlock(block, quote);
      if (hits.length === 0) return { ok: false, reason: 'not_found' };
      const narrowed = hits.filter((hit) =>
        contextMatches(block, hit, locator.prefix, locator.suffix),
      );
      if (narrowed.length === 1) return { ok: true, occurrence: narrowed[0]! };
      return { ok: false, reason: narrowed.length === 0 ? 'not_found' : 'ambiguous' };
    }
    case 'pdf': {
      const pageBlocks = blocks.filter((block) => block.pageIndex === locator.pageNumber);
      const hits = pageBlocks.flatMap((block) => occurrencesInBlock(block, quote));
      if (hits.length === 1) return { ok: true, occurrence: hits[0]! };
      return { ok: false, reason: hits.length === 0 ? 'not_found' : 'ambiguous' };
    }
    case 'quote': {
      const hits = findQuoteOccurrences(blocks, quote);
      if (hits.length === 1) return { ok: true, occurrence: hits[0]! };
      return { ok: false, reason: hits.length === 0 ? 'not_found' : 'ambiguous' };
    }
  }
}

export type QuoteResolution =
  | { status: 'resolved'; blockIndex: number; pageIndex: number }
  | { status: 'stale' };

/**
 * 解析跳转位置：先验证定位器指向的块/页，失败时要求全文唯一匹配。
 * 多个匹配或无匹配 → stale（只展示摘录，不取第一个凑数）。
 */
export function resolveQuoteLocation(
  blocks: readonly DocBlock[],
  locator: ConceptEvidenceLocator,
): QuoteResolution {
  const direct = validateEvidenceInBlocks(blocks, locator);
  if (direct.ok) {
    return {
      status: 'resolved',
      blockIndex: direct.occurrence.blockIndex,
      pageIndex: direct.occurrence.pageIndex,
    };
  }
  if (locator.kind !== 'quote') {
    const hits = findQuoteOccurrences(blocks, locator.quote);
    if (hits.length === 1) {
      return { status: 'resolved', blockIndex: hits[0]!.blockIndex, pageIndex: hits[0]!.pageIndex };
    }
  }
  return { status: 'stale' };
}
