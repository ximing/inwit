import { DEFAULT_REVIEW_SETTINGS, type ReviewFeedback, type ReviewSettings } from '@inwit/dto';

export const QUALITY_BY_FEEDBACK = {
  forgot: 1,
  fuzzy: 3,
  remembered: 5,
} as const satisfies Record<ReviewFeedback, number>;

export const MIN_EASE = 1.3;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type Sm2Settings = Pick<ReviewSettings, 'fuzzyScale' | 'learningSteps'>;

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

function resolveSm2Settings(settings?: Partial<Sm2Settings> | undefined): Sm2Settings {
  return {
    fuzzyScale: settings?.fuzzyScale ?? DEFAULT_REVIEW_SETTINGS.fuzzyScale,
    learningSteps: settings?.learningSteps ?? DEFAULT_REVIEW_SETTINGS.learningSteps,
  };
}

/**
 * SuperMemo-2. `quality < 3` resets into the first learning step; `quality == 3`
 * keeps reps and scales the previous interval by `fuzzyScale`; `quality == 5`
 * walks `learningSteps` then multiplies by ease. Ease is always adjusted,
 * floored at 1.3. Interval uses the ease from *before* this review.
 */
export function scheduleReview(
  state: Sm2State,
  feedback: ReviewFeedback,
  now = new Date(),
  settings?: Partial<Sm2Settings> | undefined,
): Sm2Result {
  const quality = qualityFor(feedback);
  const { fuzzyScale, learningSteps } = resolveSm2Settings(settings);
  let { ease, intervalDays, reps, lapses } = state;

  if (quality < 3) {
    reps = 0;
    intervalDays = learningSteps[0] ?? 1;
    lapses += 1;
  } else if (quality === 3) {
    intervalDays = Math.max(1, Math.round(intervalDays * fuzzyScale));
  } else if (reps < learningSteps.length) {
    intervalDays = learningSteps[reps] ?? 1;
    reps += 1;
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
