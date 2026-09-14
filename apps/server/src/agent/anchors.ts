/** Split markdown into 1-indexed blocks (blank-line separated; else one block). */
export function splitMarkdownBlocks(contentMd: string): { index: number; text: string }[] {
  const normalized = contentMd.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
  const chunks = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
  const blocks = chunks.length > 0 ? chunks : normalized.trim() ? [normalized.trim()] : [];
  return blocks.map((text, i) => ({ index: i + 1, text }));
}

export function parseAnchorBlock(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(1, Math.round(value));
  if (typeof value === 'string') {
    const n = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(n)) return Math.max(1, n);
  }
  return 1;
}

export type AnchorMatch = 'exact' | 'normalized' | 'block' | 'none';

export function resolveAnchor(
  contentMd: string,
  quote: string,
  blockIndex: number,
): { anchorText: string; anchorBlock: string; matched: AnchorMatch } {
  const trimmed = quote.trim();
  const blocks = splitMarkdownBlocks(contentMd);
  const requested = Math.max(1, Math.round(blockIndex));

  if (trimmed.length > 0 && contentMd.includes(trimmed)) {
    const containing = blocks.find((block) => block.text.includes(trimmed));
    const index = containing?.index ?? inferBlockIndex(blocks, trimmed, requested);
    return { anchorText: trimmed, anchorBlock: String(index), matched: 'exact' };
  }

  if (trimmed.length > 0) {
    for (const block of blocks) {
      const slice = sliceIgnoringWs(block.text, trimmed);
      if (slice) {
        return { anchorText: slice, anchorBlock: String(block.index), matched: 'normalized' };
      }
    }
    const fullSlice = sliceIgnoringWs(contentMd, trimmed);
    if (fullSlice) {
      return {
        anchorText: fullSlice,
        anchorBlock: String(inferBlockIndex(blocks, fullSlice, requested)),
        matched: 'normalized',
      };
    }
  }

  const fallback = blocks.find((block) => block.index === requested) ?? blocks[requested - 1] ?? blocks[0];
  if (fallback) {
    const sentence = firstSentence(fallback.text);
    return { anchorText: sentence, anchorBlock: String(fallback.index), matched: 'block' };
  }

  return {
    anchorText: trimmed,
    anchorBlock: String(requested),
    matched: 'none',
  };
}

function inferBlockIndex(
  blocks: { index: number; text: string }[],
  quote: string,
  requested: number,
): number {
  const hit = blocks.find((block) => block.text.includes(quote));
  if (hit) return hit.index;
  if (blocks.some((block) => block.index === requested)) return requested;
  return blocks[0]?.index ?? 1;
}

/** Map a whitespace-ignoring needle back onto a contiguous slice of `original`. */
function sliceIgnoringWs(original: string, needle: string): string | null {
  const compactNeedle = needle.replace(/\s+/g, '');
  if (!compactNeedle) return null;
  const compactHay: string[] = [];
  const indexAt: number[] = [];
  for (let i = 0; i < original.length; i += 1) {
    const ch = original[i]!;
    if (/\s/.test(ch)) continue;
    compactHay.push(ch);
    indexAt.push(i);
  }
  const hay = compactHay.join('');
  const start = hay.indexOf(compactNeedle);
  if (start < 0) return null;
  const from = indexAt[start];
  const to = indexAt[start + compactNeedle.length - 1];
  if (from === undefined || to === undefined) return null;
  return original.slice(from, to + 1);
}

function firstSentence(block: string): string {
  const line = block.replace(/\s+/g, ' ').trim();
  const cut = line.search(/[。！？]/);
  if (cut >= 7) return line.slice(0, cut + 1);
  return line.length <= 160 ? line : [...line].slice(0, 160).join('');
}

export function buildAssociationHint(concepts: string[]): string | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of concepts) {
    const concept = raw.replace(/\s+/g, ' ').trim();
    if (!concept || seen.has(concept)) continue;
    seen.add(concept);
    unique.push(concept);
  }
  if (unique.length === 0) return null;
  const shown = unique.slice(0, 3);
  if (shown.length === 1) {
    return `这和你学过的「${shown[0]}」是一回事的两种说法。`;
  }
  return `这和你学过的${shown.map((item) => `「${item}」`).join('、')}是一回事的两种说法。`;
}
