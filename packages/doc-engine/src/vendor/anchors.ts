import { IMAGE_EXCERPT_QUOTE } from '@inwit/dto';

export type AnchorKind = 'card' | 'annotation';

/** 侧边栏 / tooltip / decoration 用的按 id 索引结构。 */
export type EntityMeta = {
  id: string;
  kind: AnchorKind;
  note?: string;
};

export function noteSummary(note: string, max = 72): string {
  const chars = [...note.trim().replace(/\s+/g, ' ')];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}…`;
}

export function entitiesFromCards(
  cards: ReadonlyArray<{ id: string }>,
): EntityMeta[] {
  return cards.filter((card) => Boolean(card.id)).map((card) => ({ id: card.id, kind: 'card' as const }));
}

export function entitiesFromAnnotations(
  notes: ReadonlyArray<{ id: string; kind?: string; note?: string | null }>,
): EntityMeta[] {
  return notes
    .filter((item) => item.id && (item.kind == null || item.kind === 'text'))
    .map((item) => {
      const note = item.note?.trim() ?? '';
      return {
        id: item.id,
        kind: 'annotation' as const,
        ...(note.length > 0 ? { note: noteSummary(note) } : {}),
      };
    });
}

export function docEntities(
  cards: ReadonlyArray<{ id: string }>,
  notes: ReadonlyArray<{ id: string; kind?: string; note?: string | null }>,
): EntityMeta[] {
  return [...entitiesFromCards(cards), ...entitiesFromAnnotations(notes)];
}

export function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
      }
    } catch {
      // fall through to comma-separated
    }
  }
  return trimmed
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export function cardIdsFromAnchor(el: Element): string[] {
  const ids = parseIdList(el.getAttribute('data-card-ids'));
  const single = el.getAttribute('data-card-id')?.trim() ?? '';
  if (single && !ids.includes(single)) ids.unshift(single);
  return ids;
}

export function annotationIdsFromAnchor(el: Element): string[] {
  const ids = parseIdList(el.getAttribute('data-annotation-ids'));
  const single = el.getAttribute('data-annotation-id')?.trim() ?? '';
  if (single && !ids.includes(single)) ids.unshift(single);
  return ids;
}

export function collectHitIds(
  target: Element,
  root: Element,
): { cardIds: string[]; annotationIds: string[] } {
  const cards = new Set<string>();
  const notes = new Set<string>();
  let el: Element | null = target;
  while (el) {
    for (const id of cardIdsFromAnchor(el)) cards.add(id);
    for (const id of annotationIdsFromAnchor(el)) notes.add(id);
    if (el === root) break;
    el = el.parentElement;
  }
  return { cardIds: [...cards], annotationIds: [...notes] };
}

export const ANCHOR_HIT_SELECTOR =
  '[data-card-ids], [data-card-id], [data-annotation-id], [data-annotation-ids], .anchor, .anchor-note';

export function isExcerptQuote(quote: string | null | undefined): boolean {
  return (quote?.trim() ?? '') === IMAGE_EXCERPT_QUOTE;
}
