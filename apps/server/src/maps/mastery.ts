import type { MapNodeStatus, ReviewFeedback } from '@inwit/dto';

/** A node is `covered` when at least this share of its cards was last remembered. */
export const COVERED_MASTERY_THRESHOLD = 0.8;

/**
 * Per-card mastery used for map nodes.
 *
 * Definition: 1 if the latest `review_states.last_feedback` is `remembered`, else 0
 * (including never-reviewed / forgot / fuzzy). Node mastery is the mean of its cards.
 *
 * Ease-normalization was rejected: a brand-new card defaults to ease 2.5, which would
 * look nearly mastered before the user has reviewed it.
 */
export function cardMastery(lastFeedback: ReviewFeedback | null | undefined): number {
  return lastFeedback === 'remembered' ? 1 : 0;
}

export function nodeMastery(feedbacks: ReadonlyArray<ReviewFeedback | null | undefined>): number {
  if (feedbacks.length === 0) return 0;
  let remembered = 0;
  for (const feedback of feedbacks) {
    remembered += cardMastery(feedback);
  }
  return remembered / feedbacks.length;
}

export function statusFromMastery(cardCount: number, mastery: number): MapNodeStatus {
  if (cardCount <= 0) return 'uncovered';
  return mastery >= COVERED_MASTERY_THRESHOLD ? 'covered' : 'learning';
}

export function masteryPct(feedbacks: ReadonlyArray<ReviewFeedback | null | undefined>): number {
  if (feedbacks.length === 0) return 0;
  return Math.round(nodeMastery(feedbacks) * 100);
}
