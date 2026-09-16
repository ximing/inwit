import { DEFAULT_REVIEW_SETTINGS, mergeReviewSettings, reviewSettingsSchema } from '@inwit/dto';
import { describe, expect, it } from 'vitest';

describe('mergeReviewSettings', () => {
  it('returns defaults for null, undefined, and non-objects', () => {
    expect(mergeReviewSettings(null)).toEqual(DEFAULT_REVIEW_SETTINGS);
    expect(mergeReviewSettings(undefined)).toEqual(DEFAULT_REVIEW_SETTINGS);
    expect(mergeReviewSettings('nope')).toEqual(DEFAULT_REVIEW_SETTINGS);
    expect(mergeReviewSettings([1, 2, 3])).toEqual(DEFAULT_REVIEW_SETTINGS);
  });

  it('fills missing fields from defaults', () => {
    expect(mergeReviewSettings({ dailyReviewLimit: 40 })).toEqual({
      ...DEFAULT_REVIEW_SETTINGS,
      dailyReviewLimit: 40,
    });
  });

  it('keeps valid fields and replaces invalid ones with defaults', () => {
    expect(
      mergeReviewSettings({
        dailyReviewLimit: 200,
        dailyNewLimit: 8,
        startingEase: 1.1,
        fuzzyScale: 1.4,
        learningSteps: [1, 1, 3],
      }),
    ).toEqual({
      dailyReviewLimit: DEFAULT_REVIEW_SETTINGS.dailyReviewLimit,
      dailyNewLimit: 8,
      startingEase: DEFAULT_REVIEW_SETTINGS.startingEase,
      fuzzyScale: 1.4,
      learningSteps: DEFAULT_REVIEW_SETTINGS.learningSteps,
    });
  });

  it('does not mutate DEFAULT_REVIEW_SETTINGS.learningSteps', () => {
    const merged = mergeReviewSettings(null);
    merged.learningSteps.push(10);
    expect(DEFAULT_REVIEW_SETTINGS.learningSteps).toEqual([1, 3, 6]);
  });
});

describe('reviewSettingsSchema (PUT body)', () => {
  const valid: typeof DEFAULT_REVIEW_SETTINGS = {
    dailyReviewLimit: 20,
    dailyNewLimit: 5,
    startingEase: 2.5,
    fuzzyScale: 1.2,
    learningSteps: [1, 3, 6],
  };

  it('accepts a complete valid payload', () => {
    expect(reviewSettingsSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a partial payload (whole replace)', () => {
    expect(reviewSettingsSchema.safeParse({ dailyReviewLimit: 10 }).success).toBe(false);
  });

  it('rejects out-of-range values and non-increasing steps', () => {
    expect(
      reviewSettingsSchema.safeParse({ ...valid, dailyReviewLimit: 4 }).success,
    ).toBe(false);
    expect(reviewSettingsSchema.safeParse({ ...valid, dailyNewLimit: 31 }).success).toBe(false);
    expect(reviewSettingsSchema.safeParse({ ...valid, startingEase: 1.29 }).success).toBe(false);
    expect(reviewSettingsSchema.safeParse({ ...valid, fuzzyScale: 0.9 }).success).toBe(false);
    expect(
      reviewSettingsSchema.safeParse({ ...valid, learningSteps: [1, 3, 3] }).success,
    ).toBe(false);
    expect(
      reviewSettingsSchema.safeParse({ ...valid, learningSteps: [1, 3, 6, 10, 12] }).success,
    ).toBe(false);
  });
});
