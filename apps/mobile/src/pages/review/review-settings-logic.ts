import { DEFAULT_REVIEW_SETTINGS, mergeReviewSettings, type ReviewSettings } from '@inwit/dto';

export const LEARNING_STEP_OPTIONS = [1, 3, 6, 10] as const;

export function cloneSettings(settings: ReviewSettings): ReviewSettings {
  return {
    dailyReviewLimit: settings.dailyReviewLimit,
    dailyNewLimit: settings.dailyNewLimit,
    startingEase: settings.startingEase,
    fuzzyScale: settings.fuzzyScale,
    learningSteps: [...settings.learningSteps],
  };
}

export function tenths(n: number): number {
  return Math.round(n * 10) / 10;
}

export function formatMult(n: number): string {
  return tenths(n).toFixed(1);
}

function allowedSteps(steps: number[]): number[] {
  const allowed = new Set<number>(LEARNING_STEP_OPTIONS);
  const next = steps.filter((step) => allowed.has(step)).sort((a, b) => a - b);
  return next.length > 0 ? next : [...DEFAULT_REVIEW_SETTINGS.learningSteps];
}

/** UI clamp, same as web `apps/web/src/pages/review/index.tsx` `normalizeDraft`. */
export function normalizeDraft(draft: ReviewSettings): ReviewSettings {
  return {
    dailyReviewLimit: Math.min(100, Math.max(5, Math.round(draft.dailyReviewLimit))),
    dailyNewLimit: Math.min(30, Math.max(0, Math.round(draft.dailyNewLimit))),
    startingEase: Math.min(3, Math.max(1.3, tenths(draft.startingEase))),
    fuzzyScale: Math.min(1.5, Math.max(1, tenths(draft.fuzzyScale))),
    learningSteps: allowedSteps(draft.learningSteps),
  };
}

/**
 * Local adopt of API/raw JSON. Bad/partial fields silently fall back to defaults
 * via dto `mergeReviewSettings` (same as server stored-JSON merge).
 */
export function adoptSettings(raw: unknown): ReviewSettings {
  return cloneSettings(mergeReviewSettings(raw));
}
