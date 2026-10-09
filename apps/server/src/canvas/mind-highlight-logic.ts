import { locateQuote, type PmJson } from '@inwit/doc-schema';

/** 划线必须落在指定块里。对不上就整批作废，不写一条没有锚点的批注。 */
export function locateHighlightQuote(
  doc: PmJson,
  blockIndex: number,
  quote: string,
): { ok: true } | { ok: false; reason: string } {
  const reason = `第 ${String(blockIndex)} 块里找不到这句`;
  try {
    if (!locateQuote(doc, blockIndex, quote)) return { ok: false, reason };
    return { ok: true };
  } catch {
    return { ok: false, reason };
  }
}
