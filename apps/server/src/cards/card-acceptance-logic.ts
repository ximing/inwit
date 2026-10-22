import { codePointsAtMost, type CardAcceptance } from '@inwit/dto';

export { codePointsAtMost };

export function shouldIndexCard(card: {
  acceptance: CardAcceptance;
  deletedAt: Date | string | null;
}): boolean {
  return card.acceptance === 'accepted' && card.deletedAt == null;
}

export type CardAcceptanceDecision =
  | { kind: 'accept' }
  | { kind: 'reject'; from: 'proposed' | 'accepted' }
  | { kind: 'noop' }
  | { kind: 'not_acceptable' }
  | { kind: 'already_reviewed' };

/** What accept/reject may do. Callers still 404 missing rows and 409 an in-progress digest first. */
export function decideCardAcceptance(input: {
  acceptance: CardAcceptance;
  action: 'accept' | 'reject';
  hasReviewLogs: boolean;
}): CardAcceptanceDecision {
  if (input.acceptance === 'rejected') {
    if (input.action === 'accept') return { kind: 'not_acceptable' };
    return { kind: 'noop' };
  }
  if (input.acceptance === 'accepted') {
    if (input.action === 'accept') return { kind: 'noop' };
    if (input.hasReviewLogs) return { kind: 'already_reviewed' };
    return { kind: 'reject', from: 'accepted' };
  }
  if (input.action === 'accept') return { kind: 'accept' };
  return { kind: 'reject', from: 'proposed' };
}

/** Strip NUL and trim. Empty becomes null. Callers still enforce the code-point cap. */
export function normalizeRejectReason(reason: string | undefined): string | null {
  if (reason === undefined) return null;
  const stripped = reason.replaceAll('\0', '').trim();
  return stripped.length === 0 ? null : stripped;
}

export type CardIndexFailure = 'swallow' | 'delete-card' | 'rollback-accept';

export type CardIndexRequest =
  | { reason: 'manual' }
  | { reason: 'resurface' }
  | { reason: 'digest'; proposed: boolean }
  | { reason: 'selection' }
  | { reason: 'evolve' }
  | { reason: 'accept' }
  | { reason: 'practice' };

export type CardIndexPlan =
  | { index: true; onFailure: CardIndexFailure }
  | { index: false };

/**
 * Whether this write indexes the card, and how that call site finishes if
 * indexing throws. Proposed digest cards and concept-practice cards stay out
 * of the index. Callers still run tryIndexCard or indexCard themselves.
 */
export function planCardIndex(input: CardIndexRequest): CardIndexPlan {
  switch (input.reason) {
    case 'manual':
    case 'resurface':
      return { index: true, onFailure: 'swallow' };
    case 'digest':
      if (input.proposed) return { index: false };
      return { index: true, onFailure: 'delete-card' };
    case 'selection':
    case 'evolve':
      return { index: true, onFailure: 'delete-card' };
    case 'accept':
      return { index: true, onFailure: 'rollback-accept' };
    case 'practice':
      return { index: false };
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

/** Meili ids that are not an accepted live card are removed; missing accepted ids are indexed. */
export function planSearchBackfill(input: {
  indexedIds: readonly string[];
  cards: readonly { id: string; acceptance: CardAcceptance; deletedAt: Date | string | null }[];
}): { indexIds: string[]; deleteIds: string[] } {
  const indexable = new Set<string>();
  for (const card of input.cards) {
    if (shouldIndexCard(card)) indexable.add(card.id);
  }
  const indexed = new Set(input.indexedIds);
  return {
    deleteIds: input.indexedIds.filter((id) => !indexable.has(id)),
    indexIds: [...indexable].filter((id) => !indexed.has(id)),
  };
}
