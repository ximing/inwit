import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';

export type AnchorKind = 'card' | 'annotation';

export type AnchorSpec = {
  id: string;
  text: string;
  kind: AnchorKind;
  note?: string;
};

export function anchorsFromCards(
  cards: ReadonlyArray<{ id: string; anchorText?: string | null }>,
): AnchorSpec[] {
  return cards
    .filter((card) => {
      const text = card.anchorText?.trim() ?? '';
      return text.length > 0 && text !== IMAGE_EXCERPT_QUOTE;
    })
    .map((card) => ({ id: card.id, text: card.anchorText as string, kind: 'card' as const }));
}

export function anchorsFromAnnotations(
  notes: ReadonlyArray<{ id: string; quote: string; note?: string | null }>,
): AnchorSpec[] {
  return notes
    .filter((item) => {
      const quote = item.quote.trim();
      return quote.length > 0 && quote !== IMAGE_EXCERPT_QUOTE;
    })
    .map((item) => {
      const note = item.note?.trim() ?? '';
      return {
        id: item.id,
        text: item.quote,
        kind: 'annotation' as const,
        ...(note.length > 0 ? { note } : {}),
      };
    });
}

export function docAnchors(
  cards: ReadonlyArray<{ id: string; anchorText?: string | null }>,
  notes: ReadonlyArray<{ id: string; quote: string; note?: string | null }>,
): AnchorSpec[] {
  return [...anchorsFromCards(cards), ...anchorsFromAnnotations(notes)];
}

export function noteSummary(note: string, max = 72): string {
  const chars = [...note.trim().replace(/\s+/g, ' ')];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}…`;
}

/** Longer quotes first so nested/shorter matches do not steal the range. */
export function groupAnchorsByText(
  anchors: AnchorSpec[],
): Array<{ text: string; ids: string[]; kind: AnchorKind; note?: string }> {
  const grouped = new Map<string, { ids: string[]; kind: AnchorKind; note?: string }>();
  for (const anchor of anchors) {
    const text = anchor.text.trim();
    if (!text || !anchor.id) continue;
    const key = `${anchor.kind}\0${text}`;
    const list = grouped.get(key);
    if (!list) {
      grouped.set(key, {
        ids: [anchor.id],
        kind: anchor.kind,
        ...(anchor.note ? { note: anchor.note } : {}),
      });
      continue;
    }
    if (!list.ids.includes(anchor.id)) list.ids.push(anchor.id);
    if (!list.note && anchor.note) list.note = anchor.note;
  }
  return [...grouped.entries()]
    .map(([key, value]) => ({ text: key.slice(key.indexOf('\0') + 1), ...value }))
    .sort((a, b) => b.text.length - a.text.length);
}

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

function markSelector(kind: AnchorKind): string {
  return kind === 'annotation' ? 'mark.anchor-note' : 'mark.anchor';
}

function collectTextNodes(root: Node, kind: AnchorKind): Text[] {
  const skip = markSelector(kind);
  const out: Text[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(skip)) return NodeFilter.FILTER_REJECT;
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

function mergeIds(el: HTMLElement, extra: string[], kind: AnchorKind): void {
  const attr = kind === 'annotation' ? 'annotationIds' : 'cardIds';
  const single = kind === 'annotation' ? 'annotationId' : 'cardId';
  const have = new Set(
    (el.dataset[attr] ?? el.dataset[single] ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
  for (const id of extra) have.add(id);
  const ids = [...have];
  el.dataset[attr] = ids.join(',');
  el.dataset[single] = ids[0] ?? '';
}

function applyNoteMeta(el: HTMLElement, note?: string): void {
  if (!note) return;
  const summary = noteSummary(note);
  if (!summary) return;
  el.dataset.note = summary;
  el.setAttribute('aria-label', `批注：${summary}`);
}

function wrapWhole(
  node: Text,
  ids: string[],
  kind: AnchorKind,
  note?: string,
): void {
  const parent = node.parentNode;
  if (!parent) return;
  const selector = markSelector(kind);
  if (parent instanceof HTMLElement && parent.matches(selector)) {
    mergeIds(parent, ids, kind);
    if (kind === 'annotation') applyNoteMeta(parent, note);
    return;
  }
  const mark = document.createElement('mark');
  mark.className = kind === 'annotation' ? 'anchor-note' : 'anchor';
  if (kind === 'annotation') {
    mark.dataset.annotationId = ids[0] ?? '';
    mark.dataset.annotationIds = ids.join(',');
    applyNoteMeta(mark, note);
  } else {
    mark.dataset.cardId = ids[0] ?? '';
    mark.dataset.cardIds = ids.join(',');
  }
  parent.replaceChild(mark, node);
  mark.appendChild(node);
}

function wrapNodeSlice(
  node: Text,
  start: number,
  end: number,
  ids: string[],
  kind: AnchorKind,
  note?: string,
): void {
  const text = node.nodeValue ?? '';
  if (start <= 0 && end >= text.length) {
    wrapWhole(node, ids, kind, note);
    return;
  }
  const rest = start > 0 ? node.splitText(start) : node;
  const sliceEnd = start > 0 ? end - start : end;
  rest.splitText(sliceEnd);
  wrapWhole(rest, ids, kind, note);
}

function fallbackBlock(
  root: HTMLElement,
  needle: string,
  ids: string[],
  kind: AnchorKind,
  note?: string,
): boolean {
  const blocks = root.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, pre');
  const cls = kind === 'annotation' ? 'anchor-note-block' : 'anchor-block';
  for (const block of blocks) {
    if (!(block instanceof HTMLElement)) continue;
    if (!(block.textContent ?? '').includes(needle)) continue;
    block.classList.add(cls);
    mergeIds(block, ids, kind);
    if (kind === 'annotation') applyNoteMeta(block, note);
    return true;
  }
  return false;
}

export function wrapAnchors(
  root: HTMLElement,
  anchors: AnchorSpec[],
): { wrapped: number; fallback: number } {
  const items = groupAnchorsByText(anchors);
  let wrapped = 0;
  let fallback = 0;

  for (const { text, ids, kind, note } of items) {
    const nodes = collectTextNodes(root, kind);
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
      if (fallbackBlock(root, text, ids, kind, note)) fallback += 1;
      continue;
    }
    for (const range of ranges.slice().reverse()) {
      const hits = mapRangeToPieces(pieces, range.start, range.end);
      for (const hit of hits.slice().reverse()) {
        wrapNodeSlice(hit.node, hit.start, hit.end, ids, kind, note);
      }
      wrapped += 1;
    }
  }
  return { wrapped, fallback };
}

function idsFromAttr(el: Element, multi: string, single: string): string[] {
  const raw = el.getAttribute(multi) ?? el.getAttribute(single) ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function cardIdsFromAnchor(el: Element): string[] {
  return idsFromAttr(el, 'data-card-ids', 'data-card-id');
}

export function annotationIdsFromAnchor(el: Element): string[] {
  return idsFromAttr(el, 'data-annotation-ids', 'data-annotation-id');
}

export const ANCHOR_HIT_SELECTOR =
  'mark.anchor, .anchor-block, mark.anchor-note, .anchor-note-block, .ProseMirror .anchor, .ProseMirror .anchor-note';
