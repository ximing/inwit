import type { Node } from 'prosemirror-model';
import { inlineTextOf, loadPmDoc, mapTextSpanToPm, textPiecesOf } from './pm.js';
import type { PmJson, TextRange } from './types.js';

function findQuoteInText(text: string, quote: string): { start: number; end: number } | null {
  if (quote.length === 0) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };

  const compactNeedle = quote.replace(/\s+/g, '');
  if (compactNeedle.length === 0) return null;

  const compactHay: string[] = [];
  const indexAt: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    compactHay.push(ch);
    indexAt.push(i);
  }
  const start = compactHay.join('').indexOf(compactNeedle);
  if (start < 0) return null;
  const from = indexAt[start];
  const to = indexAt[start + compactNeedle.length - 1];
  if (from === undefined || to === undefined) return null;
  return { start: from, end: to + 1 };
}

export type LocatedQuote = {
  blockIndex: number;
  range: TextRange;
};

function quoteInBlock(node: Node, pos: number, index: number, quote: string): LocatedQuote | null {
  if (node.type.name === 'pageBreak') return null;
  const text = inlineTextOf(node);
  const span = findQuoteInText(text, quote);
  if (!span) return null;
  const range = mapTextSpanToPm(textPiecesOf(node, pos), span.start, span.end);
  if (!range) return null;
  return { blockIndex: index + 1, range };
}

export function locateQuote(doc: PmJson, blockIndex: number, quote: string): TextRange | null {
  if (quote.length === 0 || !Number.isFinite(blockIndex) || blockIndex < 1) return null;
  const target = Math.round(blockIndex);
  const pm = loadPmDoc(doc);
  const hits: LocatedQuote[] = [];
  pm.forEach((node, pos, index) => {
    if (index + 1 !== target) return;
    const hit = quoteInBlock(node, pos, index, quote);
    if (hit) hits.push(hit);
  });
  return hits[0]?.range ?? null;
}

/** 摘录出现过的每一个顶层块。匹配规则与 locateQuote 相同，含空白折叠。 */
export function findQuoteHits(doc: PmJson, quote: string): LocatedQuote[] {
  if (quote.length === 0) return [];
  let pm: ReturnType<typeof loadPmDoc>;
  try {
    pm = loadPmDoc(doc);
  } catch {
    return [];
  }
  const hits: LocatedQuote[] = [];
  pm.forEach((node, pos, index) => {
    const hit = quoteInBlock(node, pos, index, quote);
    if (hit) hits.push(hit);
  });
  return hits;
}

/**
 * 先用记下的块号。对不上时，摘录只出现在一块就用那一块；
 * 出现在多块且给了块号，就取离块号最近的一处。没有块号又有多处时不猜。
 */
export function locateQuoteInDocument(
  doc: PmJson,
  quote: string,
  preferredBlockIndex?: number | null,
): LocatedQuote | null {
  const preferred =
    typeof preferredBlockIndex === 'number' && Number.isFinite(preferredBlockIndex)
      ? Math.round(preferredBlockIndex)
      : null;
  if (preferred != null && preferred >= 1) {
    const range = locateQuote(doc, preferred, quote);
    if (range) return { blockIndex: preferred, range };
  }
  const hits = findQuoteHits(doc, quote);
  if (hits.length === 1) return hits[0] ?? null;
  if (hits.length > 1 && preferred != null && preferred >= 1) {
    return hits.reduce((best, hit) =>
      Math.abs(hit.blockIndex - preferred) < Math.abs(best.blockIndex - preferred) ? hit : best,
    );
  }
  return null;
}
