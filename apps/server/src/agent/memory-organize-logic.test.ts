import { describe, expect, it } from 'vitest';
import {
  ORGANIZE_BATCH_MAX,
  ORGANIZE_COUNT_THRESHOLD,
  ORGANIZE_DAILY_CAP,
  ORGANIZE_DEBOUNCE_MS,
  ORGANIZE_SLOT_HOURS,
  planMemoryOrganize,
  type MemoryOrganizePending,
  type MemoryOrganizePlan,
} from './memory-organize-logic.js';

function at(day: number, hour: number, minute = 0, second = 0, ms = 0): Date {
  return new Date(2026, 8, day, hour, minute, second, ms);
}

function plan(input: {
  unconsumed: number;
  now: Date;
  revisionsToday?: number;
  running?: boolean;
  pending?: MemoryOrganizePending | null;
}): MemoryOrganizePlan {
  return planMemoryOrganize({
    unconsumed: input.unconsumed,
    revisionsToday: input.revisionsToday ?? 0,
    now: input.now,
    running: input.running ?? false,
    pending: input.pending ?? null,
  });
}

describe('planMemoryOrganize constants', () => {
  it('uses the single batch, threshold, debounce, cap, and slot set', () => {
    expect(ORGANIZE_BATCH_MAX).toBe(12);
    expect(ORGANIZE_COUNT_THRESHOLD).toBe(12);
    expect(ORGANIZE_DEBOUNCE_MS).toBe(10 * 60 * 1000);
    expect(ORGANIZE_DAILY_CAP).toBe(8);
    expect(ORGANIZE_SLOT_HOURS).toEqual([0, 6, 12, 18]);
  });
});

describe('planMemoryOrganize', () => {
  const now = at(24, 10, 15, 30);

  it('skips when nothing is unconsumed', () => {
    expect(plan({ unconsumed: 0, now })).toEqual({ action: 'skip' });
    expect(
      plan({
        unconsumed: 0,
        now,
        revisionsToday: 8,
        pending: { runAt: at(24, 12), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
  });

  it('skips while a job is already running', () => {
    expect(
      plan({
        unconsumed: 20,
        now,
        running: true,
        pending: { runAt: at(24, 18), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
  });

  it('enqueues a count trigger ten minutes out once unconsumed reaches 12', () => {
    expect(plan({ unconsumed: 12, now })).toEqual({
      action: 'enqueue',
      runAt: new Date(now.getTime() + ORGANIZE_DEBOUNCE_MS),
      trigger: 'count',
    });
    expect(plan({ unconsumed: 40, now }).action).toBe('enqueue');
  });

  it('pulls a later pending forward to the count time and does not delay an earlier one', () => {
    const runAt = new Date(now.getTime() + ORGANIZE_DEBOUNCE_MS);
    expect(
      plan({
        unconsumed: 12,
        now,
        pending: { runAt: at(24, 18), trigger: 'slot' },
      }),
    ).toEqual({ action: 'postpone', runAt, trigger: 'count' });
    expect(
      plan({
        unconsumed: 15,
        now,
        pending: { runAt: at(24, 10, 20), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
    expect(
      plan({
        unconsumed: 12,
        now,
        pending: { runAt, trigger: 'count' },
      }),
    ).toEqual({ action: 'skip' });
  });

  it('enqueues the next local slot when the tail is under 12', () => {
    expect(plan({ unconsumed: 1, now: at(24, 0, 0, 0) })).toEqual({
      action: 'enqueue',
      runAt: at(24, 6),
      trigger: 'slot',
    });
    expect(plan({ unconsumed: 11, now: at(24, 6, 0, 0) })).toEqual({
      action: 'enqueue',
      runAt: at(24, 12),
      trigger: 'slot',
    });
    expect(plan({ unconsumed: 3, now: at(24, 6, 0, 0, 1) })).toEqual({
      action: 'enqueue',
      runAt: at(24, 12),
      trigger: 'slot',
    });
    expect(plan({ unconsumed: 11, now: at(24, 17, 59, 59, 999) })).toEqual({
      action: 'enqueue',
      runAt: at(24, 18),
      trigger: 'slot',
    });
    expect(plan({ unconsumed: 4, now: at(24, 18, 0, 0) })).toEqual({
      action: 'enqueue',
      runAt: at(25, 0),
      trigger: 'slot',
    });
    expect(plan({ unconsumed: 4, now: at(24, 21, 30) })).toEqual({
      action: 'enqueue',
      runAt: at(25, 0),
      trigger: 'slot',
    });
  });

  it('does not postpone an existing count trigger or move an already-later slot', () => {
    expect(
      plan({
        unconsumed: 5,
        now,
        pending: { runAt: new Date(now.getTime() + ORGANIZE_DEBOUNCE_MS), trigger: 'count' },
      }),
    ).toEqual({ action: 'skip' });
    expect(
      plan({
        unconsumed: 2,
        now,
        pending: { runAt: at(24, 18), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
    expect(
      plan({
        unconsumed: 2,
        now,
        pending: { runAt: at(24, 12), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
    expect(
      plan({
        unconsumed: 2,
        now,
        pending: { runAt: at(24, 6), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
  });

  it('schedules the next local midnight once the daily revision cap is hit, and does not pull a later pending earlier', () => {
    expect(plan({ unconsumed: 20, now, revisionsToday: 8 })).toEqual({
      action: 'enqueue',
      runAt: at(25, 0),
      trigger: 'slot',
    });
    expect(plan({ unconsumed: 3, now: at(24, 10), revisionsToday: 9 })).toEqual({
      action: 'enqueue',
      runAt: at(25, 0),
      trigger: 'slot',
    });
    expect(
      plan({
        unconsumed: 12,
        now,
        revisionsToday: 8,
        pending: { runAt: new Date(now.getTime() + ORGANIZE_DEBOUNCE_MS), trigger: 'count' },
      }),
    ).toEqual({ action: 'postpone', runAt: at(25, 0), trigger: 'slot' });
    expect(
      plan({
        unconsumed: 12,
        now,
        revisionsToday: 8,
        pending: { runAt: at(25, 0), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
    expect(
      plan({
        unconsumed: 4,
        now,
        revisionsToday: 8,
        pending: { runAt: at(25, 18), trigger: 'slot' },
      }),
    ).toEqual({ action: 'skip' });
  });
});
