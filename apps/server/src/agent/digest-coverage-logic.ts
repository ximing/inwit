/**
 * Long digests should keep reading and place cards past the opening.
 * Returns a nudge message, or null when the run has covered enough to finish.
 */
export function digestCoverageGap(input: {
  lastBlockIndex: number;
  readThrough: number | null;
  truncated: boolean;
  anchors: readonly (number | null)[];
}): string | null {
  if (input.lastBlockIndex < 24) return null;
  const through = input.readThrough ?? 0;
  if (input.truncated || input.readThrough === null || through < input.lastBlockIndex) {
    const next = input.readThrough === null ? 1 : through + 1;
    return `原文还没读完（已到块 ${String(through)} / ${String(input.lastBlockIndex)}）。请 read_document，fromBlock 用 ${String(next)}，并为后面的段落继续 write_cards。不要只切开头。`;
  }
  const anchors = input.anchors.filter((index): index is number => typeof index === 'number' && index > 0);
  if (input.lastBlockIndex >= 40 && anchors.length >= 2) {
    const furthest = Math.max(...anchors);
    if (furthest < Math.floor(input.lastBlockIndex * 0.55)) {
      return `卡片都落在前半（最远块 ${String(furthest)} / ${String(input.lastBlockIndex)}）。请为后半继续 read_document 并 write_cards，quote 用后半原文。`;
    }
  }
  return null;
}
