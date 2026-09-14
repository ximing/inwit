export type AnchorSpec = { cardId: string; text: string };

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);

export function findSubstringRanges(
  haystack: string,
  needle: string,
): { start: number; end: number }[] {
  if (!needle) return [];
  const ranges: { start: number; end: number }[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    ranges.push({ start: index, end: index + needle.length });
    from = index + needle.length;
  }
  if (ranges.length > 0) return ranges;
  return findIgnoringWs(haystack, needle);
}

function findIgnoringWs(haystack: string, needle: string): { start: number; end: number }[] {
  const compactNeedle = needle.replace(/\s+/g, '');
  if (!compactNeedle) return [];
  const compact: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < haystack.length; i += 1) {
    const ch = haystack[i]!;
    if (/\s/.test(ch)) continue;
    compact.push(ch);
    map.push(i);
  }
  const hay = compact.join('');
  const start = hay.indexOf(compactNeedle);
  if (start < 0) return [];
  const from = map[start];
  const last = map[start + compactNeedle.length - 1];
  if (from === undefined || last === undefined) return [];
  return [{ start: from, end: last + 1 }];
}

function collectTextNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('mark.anchor')) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current: Node | null;
  while ((current = walk.nextNode())) out.push(current as Text);
  return out;
}

type Piece = { node: Text; start: number; end: number };

function mapRangeToPieces(
  pieces: Piece[],
  start: number,
  end: number,
): { node: Text; start: number; end: number }[] {
  const hits: { node: Text; start: number; end: number }[] = [];
  for (const piece of pieces) {
    const s = Math.max(start, piece.start);
    const e = Math.min(end, piece.end);
    if (s < e) hits.push({ node: piece.node, start: s - piece.start, end: e - piece.start });
  }
  return hits;
}

function mergeCardIds(el: HTMLElement, extra: string[]): void {
  const have = new Set(
    (el.dataset.cardIds ?? el.dataset.cardId ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  for (const id of extra) have.add(id);
  const ids = [...have];
  el.dataset.cardIds = ids.join(',');
  el.dataset.cardId = ids[0] ?? '';
}

function wrapWhole(node: Text, cardIds: string[]): void {
  const parent = node.parentNode;
  if (!parent) return;
  if (parent instanceof HTMLElement && parent.matches('mark.anchor')) {
    mergeCardIds(parent, cardIds);
    return;
  }
  const mark = document.createElement('mark');
  mark.className = 'anchor';
  mark.dataset.cardId = cardIds[0] ?? '';
  mark.dataset.cardIds = cardIds.join(',');
  parent.replaceChild(mark, node);
  mark.appendChild(node);
}

function wrapNodeSlice(node: Text, start: number, end: number, cardIds: string[]): void {
  const text = node.nodeValue ?? '';
  if (start <= 0 && end >= text.length) {
    wrapWhole(node, cardIds);
    return;
  }
  const rest = start > 0 ? node.splitText(start) : node;
  const sliceEnd = start > 0 ? end - start : end;
  rest.splitText(sliceEnd);
  wrapWhole(rest, cardIds);
}

function fallbackBlock(root: HTMLElement, needle: string, cardIds: string[]): boolean {
  const blocks = root.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, pre');
  for (const block of blocks) {
    if (!(block instanceof HTMLElement)) continue;
    if (!(block.textContent ?? '').includes(needle)) continue;
    block.classList.add('anchor-block');
    mergeCardIds(block, cardIds);
    return true;
  }
  return false;
}

export function wrapAnchors(
  root: HTMLElement,
  anchors: AnchorSpec[],
): { wrapped: number; fallback: number } {
  const grouped = new Map<string, string[]>();
  for (const anchor of anchors) {
    const text = anchor.text.trim();
    if (!text || !anchor.cardId) continue;
    const list = grouped.get(text) ?? [];
    if (!list.includes(anchor.cardId)) list.push(anchor.cardId);
    grouped.set(text, list);
  }
  const items = [...grouped.entries()].sort((a, b) => b[0].length - a[0].length);
  let wrapped = 0;
  let fallback = 0;

  for (const [text, cardIds] of items) {
    const nodes = collectTextNodes(root);
    const pieces: Piece[] = [];
    let cursor = 0;
    for (const node of nodes) {
      const value = node.nodeValue ?? '';
      pieces.push({ node, start: cursor, end: cursor + value.length });
      cursor += value.length;
    }
    const haystack = pieces.map((piece) => piece.node.nodeValue ?? '').join('');
    const ranges = findSubstringRanges(haystack, text);
    if (ranges.length === 0) {
      if (fallbackBlock(root, text, cardIds)) fallback += 1;
      continue;
    }
    for (const range of ranges.slice().reverse()) {
      const hits = mapRangeToPieces(pieces, range.start, range.end);
      for (const hit of hits.slice().reverse()) {
        wrapNodeSlice(hit.node, hit.start, hit.end, cardIds);
      }
      wrapped += 1;
    }
  }
  return { wrapped, fallback };
}

export function cardIdsFromAnchor(el: Element): string[] {
  const raw = el.getAttribute('data-card-ids') ?? el.getAttribute('data-card-id') ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
