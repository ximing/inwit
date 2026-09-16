import { describe, expect, it } from 'vitest';
import { MIN_EASE, MS_PER_DAY, qualityFor, scheduleReview, type Sm2State } from './sm2.js';

const INITIAL: Sm2State = { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0 };

function easeDelta(quality: number): number {
  return 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
}

describe('qualityFor', () => {
  it('maps the three feedback grades onto SM-2 quality', () => {
    expect(qualityFor('forgot')).toBe(1);
    expect(qualityFor('fuzzy')).toBe(3);
    expect(qualityFor('remembered')).toBe(5);
  });
});

describe('scheduleReview', () => {
  const now = new Date('2026-09-14T08:00:00.000Z');

  it('remembered from a new card: interval 1 day, reps 1, ease +0.1', () => {
    const next = scheduleReview(INITIAL, 'remembered', now);
    expect(next.quality).toBe(5);
    expect(next.intervalDays).toBe(1);
    expect(next.reps).toBe(1);
    expect(next.lapses).toBe(0);
    expect(next.ease).toBeCloseTo(2.5 + easeDelta(5), 8);
    expect(next.dueAt.getTime()).toBe(now.getTime() + MS_PER_DAY);
  });

  it('second remembered: interval 3 days (default steps [1,3,6]), reps 2', () => {
    const first = scheduleReview(INITIAL, 'remembered', now);
    const second = scheduleReview(first, 'remembered', now);
    expect(second.intervalDays).toBe(3);
    expect(second.reps).toBe(2);
    expect(second.lapses).toBe(0);
    expect(second.ease).toBeCloseTo(first.ease + easeDelta(5), 8);
    expect(second.dueAt.getTime()).toBe(now.getTime() + 3 * MS_PER_DAY);
  });

  it('third remembered: interval 6 days, reps 3', () => {
    const first = scheduleReview(INITIAL, 'remembered', now);
    const second = scheduleReview(first, 'remembered', now);
    const third = scheduleReview(second, 'remembered', now);
    expect(third.intervalDays).toBe(6);
    expect(third.reps).toBe(3);
    expect(third.ease).toBeCloseTo(second.ease + easeDelta(5), 8);
  });

  it('fourth remembered: interval = round(prev * ease before this review)', () => {
    const first = scheduleReview(INITIAL, 'remembered', now);
    const second = scheduleReview(first, 'remembered', now);
    const third = scheduleReview(second, 'remembered', now);
    const fourth = scheduleReview(third, 'remembered', now);
    expect(fourth.intervalDays).toBe(Math.round(third.intervalDays * third.ease));
    expect(fourth.reps).toBe(4);
    expect(fourth.ease).toBeCloseTo(third.ease + easeDelta(5), 8);
  });

  it('fuzzy keeps reps, interval = max(1, round(old × 1.2))', () => {
    const next = scheduleReview(INITIAL, 'fuzzy', now);
    expect(next.quality).toBe(3);
    expect(next.intervalDays).toBe(1);
    expect(next.reps).toBe(0);
    expect(next.lapses).toBe(0);
    expect(next.ease).toBeCloseTo(2.5 + easeDelta(3), 8);
    expect(next.ease).toBeCloseTo(2.36, 8);
  });

  it('forgot resets reps, sets interval to 1 day, increments lapses', () => {
    const learned: Sm2State = { ease: 2.6, intervalDays: 6, reps: 2, lapses: 0 };
    const next = scheduleReview(learned, 'forgot', now);
    expect(next.quality).toBe(1);
    expect(next.reps).toBe(0);
    expect(next.intervalDays).toBe(1);
    expect(next.lapses).toBe(1);
    expect(next.ease).toBeCloseTo(learned.ease + easeDelta(1), 8);
    expect(next.dueAt.getTime()).toBe(now.getTime() + MS_PER_DAY);
  });

  it('two consecutive forgots: interval stays 1, lapses = 2', () => {
    const once = scheduleReview(INITIAL, 'forgot', now);
    const twice = scheduleReview(once, 'forgot', now);
    expect(once.lapses).toBe(1);
    expect(twice.reps).toBe(0);
    expect(twice.intervalDays).toBe(1);
    expect(twice.lapses).toBe(2);
    expect(twice.ease).toBeCloseTo(once.ease + easeDelta(1), 8);
  });

  it('floors ease at 1.3', () => {
    const low: Sm2State = { ease: 1.35, intervalDays: 1, reps: 0, lapses: 3 };
    const next = scheduleReview(low, 'forgot', now);
    expect(next.ease).toBe(MIN_EASE);
    expect(1.35 + easeDelta(1)).toBeLessThan(MIN_EASE);
  });

  it('after a lapse, the next remembered starts the ladder at interval 1', () => {
    const lapsed = scheduleReview(
      { ease: 2.5, intervalDays: 16, reps: 4, lapses: 0 },
      'forgot',
      now,
    );
    const recovered = scheduleReview(lapsed, 'remembered', now);
    expect(lapsed.reps).toBe(0);
    expect(recovered.intervalDays).toBe(1);
    expect(recovered.reps).toBe(1);
    expect(recovered.lapses).toBe(1);
  });

  it('fuzzy on a learned card scales interval and does not advance reps', () => {
    const learned: Sm2State = { ease: 2.6, intervalDays: 6, reps: 2, lapses: 0 };
    const next = scheduleReview(learned, 'fuzzy', now);
    expect(next.reps).toBe(2);
    expect(next.lapses).toBe(0);
    expect(next.intervalDays).toBe(Math.round(6 * 1.2));
    expect(next.ease).toBeCloseTo(learned.ease + easeDelta(3), 8);
  });

  it('custom learningSteps: 1 → 6 ladder, then ease', () => {
    const steps = { learningSteps: [1, 6] };
    const first = scheduleReview(INITIAL, 'remembered', now, steps);
    const second = scheduleReview(first, 'remembered', now, steps);
    const third = scheduleReview(second, 'remembered', now, steps);
    expect(first.intervalDays).toBe(1);
    expect(second.intervalDays).toBe(6);
    expect(second.reps).toBe(2);
    expect(third.intervalDays).toBe(Math.round(second.intervalDays * second.ease));
    expect(third.reps).toBe(3);
  });

  it('forgot uses learningSteps[0] as the reset interval', () => {
    const learned: Sm2State = { ease: 2.6, intervalDays: 10, reps: 3, lapses: 1 };
    const next = scheduleReview(learned, 'forgot', now, { learningSteps: [2, 5, 9] });
    expect(next.reps).toBe(0);
    expect(next.lapses).toBe(2);
    expect(next.intervalDays).toBe(2);
    expect(next.dueAt.getTime()).toBe(now.getTime() + 2 * MS_PER_DAY);
  });

  it('custom startingEase is the ease used after the learning ladder', () => {
    const started: Sm2State = { ease: 1.8, intervalDays: 0, reps: 0, lapses: 0 };
    const first = scheduleReview(started, 'remembered', now);
    const second = scheduleReview(first, 'remembered', now);
    const third = scheduleReview(second, 'remembered', now);
    const fourth = scheduleReview(third, 'remembered', now);
    expect(first.ease).toBeCloseTo(1.8 + easeDelta(5), 8);
    expect(third.intervalDays).toBe(6);
    expect(fourth.intervalDays).toBe(Math.round(third.intervalDays * third.ease));
  });

  it('custom fuzzyScale 1.0 keeps a 1-day interval (near restart)', () => {
    const learned: Sm2State = { ease: 2.5, intervalDays: 8, reps: 3, lapses: 0 };
    const next = scheduleReview(learned, 'fuzzy', now, { fuzzyScale: 1.0 });
    expect(next.reps).toBe(3);
    expect(next.intervalDays).toBe(8);
  });
});
