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

/**
 * 相对生成时正文，改动仍允许收录本批候选的额度。
 * 不超过较长一侧的 40%，且不超过 2000 字；不满 200 字的改动一律算小改。
 */
export const CONCEPT_BATCH_SMALL_EDIT_FLOOR = 200;
export const CONCEPT_BATCH_SMALL_EDIT_CAP = 2_000;
export const CONCEPT_BATCH_SMALL_EDIT_RATIO = 0.4;

export interface SourceTextBlock {
  index: number;
  text: string;
}

/** 本批候选还能用的改动上限（Unicode code points）。 */
export function smallEditLimit(beforeChars: number, afterChars: number): number {
  const base = Math.max(beforeChars, afterChars, 1);
  const byRatio = Math.ceil(base * CONCEPT_BATCH_SMALL_EDIT_RATIO);
  return Math.max(
    CONCEPT_BATCH_SMALL_EDIT_FLOOR,
    Math.min(CONCEPT_BATCH_SMALL_EDIT_CAP, byRatio),
  );
}

/**
 * 生成时的块序列与当前块序列相比，改动是否大到应作废整批候选。
 * 只比较文本，不看块序号：段首插入新段不会把后面未改的段算成整段重写。
 */
export function conceptSourceChangeIsLarge(
  before: readonly SourceTextBlock[],
  after: readonly SourceTextBlock[],
): boolean {
  const limit = smallEditLimit(totalCodePoints(before), totalCodePoints(after));
  return changedCodePoints(before, after, limit) > limit;
}

/**
 * 选段批次只比较当时选中的块区间；全文批次比较全部块。
 * hash 仍一致时直接可用。没有块快照时无法衡量幅度，hash 不一致即作废。
 */
export function sourceBlocksAreStale(input: {
  scope: 'document' | 'selection';
  documentHash: string;
  selection: { fromBlockIndex: number; toBlockIndex: number } | null;
  snapshot: { blocks: readonly SourceTextBlock[] } | null;
  blocks: readonly DocBlock[];
}): boolean {
  const current = blocksInBatchScope(input);
  if (documentHashFromBlocks(current) === input.documentHash) return false;
  const before = input.snapshot?.blocks;
  if (!before || before.length === 0) return true;
  return conceptSourceChangeIsLarge(before, current);
}

function blocksInBatchScope(input: {
  scope: 'document' | 'selection';
  selection: { fromBlockIndex: number; toBlockIndex: number } | null;
  snapshot: { blocks: readonly SourceTextBlock[] } | null;
  blocks: readonly DocBlock[];
}): DocBlock[] {
  if (input.scope !== 'selection') return [...input.blocks];
  const indexes = input.snapshot?.blocks.map((block) => block.index) ?? [];
  const from = input.selection?.fromBlockIndex ?? (indexes.length > 0 ? Math.min(...indexes) : 1);
  const to = input.selection?.toBlockIndex ?? (indexes.length > 0 ? Math.max(...indexes) : from);
  return input.blocks.filter((block) => block.index >= from && block.index <= to);
}

function totalCodePoints(blocks: readonly SourceTextBlock[]): number {
  let total = 0;
  for (const block of blocks) total += codePointLength(block.text);
  return total;
}

function codePointLength(text: string): number {
  return [...text].length;
}

/**
 * 未改动的块按文本对齐后不计。改动块按顺序两两算编辑距离，多出来的整段按字数计。
 * 超过 limit 即停，返回值只保证「大于 limit」或「精确距离」。
 */
function changedCodePoints(
  before: readonly SourceTextBlock[],
  after: readonly SourceTextBlock[],
  limit: number,
): number {
  const ops = diffBlockTexts(
    before.map((block) => block.text),
    after.map((block) => block.text),
  );
  let changed = 0;
  let deleted: string[] = [];
  let inserted: string[] = [];
  const flush = () => {
    if (deleted.length === 0 && inserted.length === 0) return;
    changed += hunkChange(deleted, inserted, Math.max(0, limit - changed));
    deleted = [];
    inserted = [];
  };
  for (const op of ops) {
    if (changed > limit) return changed;
    if (op.op === 'eq') flush();
    else if (op.op === 'del') deleted.push(op.text);
    else inserted.push(op.text);
  }
  flush();
  return changed;
}

function hunkChange(deleted: string[], inserted: string[], budget: number): number {
  let changed = 0;
  const pairs = Math.min(deleted.length, inserted.length);
  for (let i = 0; i < pairs; i += 1) {
    const remaining = budget - changed;
    changed += editDistanceAtMost(deleted[i] ?? '', inserted[i] ?? '', remaining);
    if (changed > budget) return changed;
  }
  for (const text of [...deleted.slice(pairs), ...inserted.slice(pairs)]) {
    changed += codePointLength(text);
    if (changed > budget) return changed;
  }
  return changed;
}

/** 编辑距离；超过 limit 时返回 limit + 1，不再把整段算完。 */
function editDistanceAtMost(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (limit < 0) return 1;
  const aChars = [...a];
  const bChars = [...b];
  let start = 0;
  const shared = Math.min(aChars.length, bChars.length);
  while (start < shared && aChars[start] === bChars[start]) start += 1;
  let aEnd = aChars.length;
  let bEnd = bChars.length;
  while (aEnd > start && bEnd > start && aChars[aEnd - 1] === bChars[bEnd - 1]) {
    aEnd -= 1;
    bEnd -= 1;
  }
  const aMid = aChars.slice(start, aEnd);
  const bMid = bChars.slice(start, bEnd);
  if (aMid.length === 0) return bMid.length > limit ? limit + 1 : bMid.length;
  if (bMid.length === 0) return aMid.length > limit ? limit + 1 : aMid.length;
  if (Math.abs(aMid.length - bMid.length) > limit) return limit + 1;

  const n = aMid.length;
  const m = bMid.length;
  const inf = limit + 1;
  let prev = new Uint32Array(m + 1);
  for (let j = 0; j <= m; j += 1) prev[j] = j > limit ? inf : j;
  for (let i = 1; i <= n; i += 1) {
    const cur = new Uint32Array(m + 1);
    cur[0] = i > limit ? inf : i;
    let rowMin = cur[0] ?? inf;
    const jFrom = Math.max(1, i - limit);
    const jTo = Math.min(m, i + limit);
    for (let j = 1; j <= m; j += 1) {
      if (j < jFrom || j > jTo) {
        cur[j] = inf;
        continue;
      }
      const cost = aMid[i - 1] === bMid[j - 1] ? 0 : 1;
      const best = Math.min((prev[j] ?? inf) + 1, (cur[j - 1] ?? inf) + 1, (prev[j - 1] ?? inf) + cost);
      cur[j] = best > limit ? inf : best;
      if ((cur[j] ?? inf) < rowMin) rowMin = cur[j] ?? inf;
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  const distance = prev[m] ?? inf;
  return distance > limit ? limit + 1 : distance;
}

type BlockOp = { op: 'eq' | 'del' | 'ins'; text: string };

/** 按块文本做最长公共子序列，保留未改动的段。 */
function diffBlockTexts(before: readonly string[], after: readonly string[]): BlockOp[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = before[i] === after[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  const ops: BlockOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ op: 'eq', text: before[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ op: 'del', text: before[i]! });
      i += 1;
    } else {
      ops.push({ op: 'ins', text: after[j]! });
      j += 1;
    }
  }
  while (i < n) ops.push({ op: 'del', text: before[i++]! });
  while (j < m) ops.push({ op: 'ins', text: after[j++]! });
  return ops;
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

/**
 * 收录时把引文对准当前正文。原文定位仍有效则原样返回；
 * 块号或页码移了但引文仍能唯一找到，则改到新位置；找不到则返回 null，调用方跳过这条摘录。
 */
export function retargetEvidenceLocator(
  blocks: readonly DocBlock[],
  locator: ConceptEvidenceLocator,
): ConceptEvidenceLocator | null {
  if (validateEvidenceInBlocks(blocks, locator).ok) return locator;
  const resolved = resolveQuoteLocation(blocks, locator);
  if (resolved.status !== 'resolved') return null;
  if (locator.kind === 'quote') return locator;
  const next: ConceptEvidenceLocator =
    locator.kind === 'pdf'
      ? { kind: 'pdf', pageNumber: resolved.pageIndex, quote: locator.quote }
      : { kind: 'block', blockIndex: resolved.blockIndex, quote: locator.quote };
  return validateEvidenceInBlocks(blocks, next).ok ? next : null;
}
