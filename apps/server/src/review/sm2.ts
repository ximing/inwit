import type { ReviewFeedback } from '@inwit/dto';

export const QUALITY_BY_FEEDBACK = {
  forgot: 1,
  fuzzy: 3,
  remembered: 5,
} as const satisfies Record<ReviewFeedback, number>;

export const MIN_EASE = 1.3;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface Sm2State {
  ease: number;
  intervalDays: number;
  reps: number;
  lapses: number;
}

export interface Sm2Result extends Sm2State {
  quality: number;
  dueAt: Date;
}

export function qualityFor(feedback: ReviewFeedback): number {
  return QUALITY_BY_FEEDBACK[feedback];
}

/**
 * SuperMemo-2. `quality < 3` resets the streak; otherwise interval goes 1 → 6 → round(prev * ease).
 * Ease is always adjusted, floored at 1.3. Interval uses the ease from *before* this review.
 */
export function scheduleReview(state: Sm2State, feedback: ReviewFeedback, now = new Date()): Sm2Result {
  const quality = qualityFor(feedback);
  let { ease, intervalDays, reps, lapses } = state;

  if (quality < 3) {
    reps = 0;
    intervalDays = 1;
    lapses += 1;
  } else if (reps === 0) {
    intervalDays = 1;
    reps = 1;
  } else if (reps === 1) {
    intervalDays = 6;
    reps = 2;
  } else {
    intervalDays = Math.round(intervalDays * ease);
    reps += 1;
  }

  ease += 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  if (ease < MIN_EASE) ease = MIN_EASE;

  return {
    ease,
    intervalDays,
    reps,
    lapses,
    quality,
    dueAt: new Date(now.getTime() + intervalDays * MS_PER_DAY),
  };
}
