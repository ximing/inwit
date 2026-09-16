import { blocksFromPmJSON } from '@inwit/doc-schema';
import { asSchemaJson, isBlankPmDoc } from '@/lib/pm-doc';

export function pageTextsFromContent(contentJson: unknown): string[] {
  try {
    const blocks = blocksFromPmJSON(asSchemaJson(contentJson));
    if (blocks.length === 0) return [];
    const lastPage = blocks[blocks.length - 1]?.pageIndex ?? 1;
    const pages = Array.from({ length: lastPage }, () => '');
    for (const block of blocks) {
      if (!block.text) continue;
      const i = block.pageIndex - 1;
      if (i < 0 || i >= pages.length) continue;
      pages[i] = pages[i] ? `${pages[i]}\n\n${block.text}` : block.text;
    }
    return pages;
  } catch {
    return [];
  }
}

/**
 * 0-based PDF page. `pageIndex` wins; otherwise map `anchorBlockIndex` / `quote`
 * through numbered blocks in `contentJson`.
 */
export function pageIndexFromAnchor(input: {
  contentJson: unknown;
  pageIndex?: number | null;
  anchorBlockIndex?: number | null;
  quote?: string | null;
  pageCount?: number | null;
}): number {
  if (typeof input.pageIndex === 'number' && Number.isFinite(input.pageIndex) && input.pageIndex >= 0) {
    return Math.floor(input.pageIndex);
  }

  const clamp = (zero: number): number => {
    if (typeof input.pageCount === 'number' && input.pageCount > 0) {
      return Math.min(Math.max(0, zero), input.pageCount - 1);
    }
    return Math.max(0, zero);
  };

  try {
    const blocks = blocksFromPmJSON(asSchemaJson(input.contentJson));
    const quote = input.quote?.trim() ?? '';
    if (quote.length > 0 && blocks.length > 0) {
      const hit = blocks.find((block) => block.text.includes(quote));
      if (hit) return clamp(hit.pageIndex - 1);
    }

    if (typeof input.anchorBlockIndex === 'number' && Number.isFinite(input.anchorBlockIndex)) {
      const index = Math.round(input.anchorBlockIndex);
      const block = blocks.find((item) => item.index === index);
      if (block) return clamp(block.pageIndex - 1);
      const last = blocks[blocks.length - 1];
      if (last) return clamp(last.pageIndex - 1);
      return clamp(index - 1);
    }
  } catch {
    if (typeof input.anchorBlockIndex === 'number' && Number.isFinite(input.anchorBlockIndex)) {
      return clamp(Math.round(input.anchorBlockIndex) - 1);
    }
  }

  return 0;
}

export function isPdfOcrPending(contentJson: unknown): boolean {
  return isBlankPmDoc(contentJson);
}
