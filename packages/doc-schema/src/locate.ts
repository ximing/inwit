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

export function locateQuote(doc: PmJson, blockIndex: number, quote: string): TextRange | null {
  if (quote.length === 0 || !Number.isFinite(blockIndex) || blockIndex < 1) return null;
  const target = Math.round(blockIndex);
  const pm = loadPmDoc(doc);
  let found: { node: Node; pos: number } | undefined;
  pm.forEach((node, pos, index) => {
    if (index + 1 === target) found = { node, pos };
  });
  if (!found) return null;
  const text = found.node.type.name === 'pageBreak' ? '' : inlineTextOf(found.node);
  const span = findQuoteInText(text, quote);
  if (!span) return null;
  return mapTextSpanToPm(textPiecesOf(found.node, found.pos), span.start, span.end);
}
