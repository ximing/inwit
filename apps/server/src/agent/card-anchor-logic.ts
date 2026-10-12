import { blocksFromPmJSON, findQuoteHits, locateQuote, type DocBlock, type PmJson } from '@inwit/doc-schema';

export type CardAnchorFields = {
  anchorText: string;
  anchorBlockIndex: number | null;
};

export function formatNumberedBlockView(blocks: readonly DocBlock[]): string {
  return blocks
    .map((block) => {
      const body = block.text.length > 0 ? block.text : '（分页）';
      return `[块 ${String(block.index)} | 第 ${String(block.pageIndex)} 页] ${body}`;
    })
    .join('\n');
}

export function numberedBlocksFromDoc(doc: PmJson): {
  blocks: DocBlock[];
  numberedView: string;
} {
  const blocks = blocksFromPmJSON(doc);
  return { blocks, numberedView: formatNumberedBlockView(blocks) };
}

/**
 * write_cards / selection / split_card 共用：locate 成功写 (quote, blockIndex)，
 * 失败仍给出 quote 快照、锚为空，不抛错。
 */
export function resolveQuoteAnchor(
  contentJson: PmJson,
  blockIndex: number | null | undefined,
  quote: string,
  options?: { recover?: boolean },
): CardAnchorFields {
  const anchorText = quote.trim();
  if (anchorText.length === 0) {
    return { anchorText, anchorBlockIndex: null };
  }
  const index =
    typeof blockIndex === 'number' && Number.isFinite(blockIndex) ? Math.round(blockIndex) : null;
  if (index != null && index >= 1) {
    try {
      if (locateQuote(contentJson, index, anchorText)) {
        return { anchorText, anchorBlockIndex: index };
      }
    } catch {
      // 指定块解析失败时，recover 仍可以在全文里找唯一的一处。
    }
  }
  if (options?.recover) {
    try {
      const hits = findQuoteHits(contentJson, anchorText);
      if (hits.length === 1) {
        return { anchorText, anchorBlockIndex: hits[0]?.blockIndex ?? null };
      }
    } catch {
      // 全文也解析不了时保留摘录、不记块号。
    }
  }
  return { anchorText, anchorBlockIndex: null };
}

/** 划词产卡：每张卡继承用户提交的 (blockIndex, quote)，agent 不自行定位。 */
export function inheritSelectionAnchor(
  contentJson: PmJson,
  selection: { blockIndex?: number | undefined; quote: string },
): CardAnchorFields {
  return resolveQuoteAnchor(contentJson, selection.blockIndex, selection.quote);
}
