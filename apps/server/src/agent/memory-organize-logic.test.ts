import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  dispatchMemoryOrganizePlan,
  lockedMemoryOrganizeBatch,
  memoryBodyPreview,
  memoryOrganizeBatchKey,
  memoryOrganizeTrigger,
  normalizeMemoryRevision,
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

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

describe('memoryOrganizeBatchKey', () => {
  it('hashes the sorted ids joined by commas', () => {
    const expected = createHash('sha256').update(`${A},${B}`).digest('hex');
    expect(memoryOrganizeBatchKey([B, A])).toBe(expected);
    expect(memoryOrganizeBatchKey([A, B])).toBe(expected);
    expect(memoryOrganizeBatchKey([A, B])).toMatch(/^[0-9a-f]{64}$/);
    expect(memoryOrganizeBatchKey([A])).not.toBe(expected);
  });
});

describe('lockedMemoryOrganizeBatch', () => {
  it('leaves an unlocked payload alone and reuses a locked list without growing it', () => {
    expect(lockedMemoryOrganizeBatch({})).toBeUndefined();
    expect(lockedMemoryOrganizeBatch({ batchFeedbackIds: [] })).toEqual([]);
    expect(lockedMemoryOrganizeBatch({ batchFeedbackIds: 'nope' })).toEqual([]);
    const ids = Array.from({ length: 13 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(lockedMemoryOrganizeBatch({ batchFeedbackIds: [...ids, 'not-a-uuid'] })).toEqual(ids.slice(0, 12));
  });
});

describe('memory organize payload helpers', () => {
  it('reads only count or slot triggers and clips previews by code point', () => {
    expect(memoryOrganizeTrigger({})).toBeUndefined();
    expect(memoryOrganizeTrigger({ trigger: 'count' })).toBe('count');
    expect(memoryOrganizeTrigger({ trigger: 'later' })).toBeUndefined();
    expect(memoryBodyPreview('🙂'.repeat(81))).toBe('🙂'.repeat(80));
    expect(dispatchMemoryOrganizePlan(false, { action: 'enqueue', runAt: at(24, 12), trigger: 'slot' })).toBe('skip');
    expect(dispatchMemoryOrganizePlan(false, { action: 'postpone', runAt: at(24, 12), trigger: 'slot' })).toBe('postpone');
    expect(dispatchMemoryOrganizePlan(true, { action: 'enqueue', runAt: at(24, 12), trigger: 'count' })).toBe('enqueue');
  });
});

describe('normalizeMemoryRevision', () => {
  it('binds an id-less add to the only new collection', () => {
    const result = normalizeMemoryRevision({
      summary: '拒绝只有定义的卡',
      collections: [{ op: 'create', title: '切卡粒度', description: '要有例子' }],
      entries: [{ op: 'add', body: '这个用户拒绝只有定义、没有例子的卡' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entries[0]).toEqual({
      op: 'add',
      target: { kind: 'create', index: 0 },
      body: '这个用户拒绝只有定义、没有例子的卡',
    });
  });

  it('lets a fresh create id be referenced by an entry and rejects a second unlabeled add', () => {
    const linked = normalizeMemoryRevision({
      summary: '对照旧卡',
      collections: [
        { op: 'create', id: C, title: '易混点', description: '讲梯度时对照反向传播' },
        { op: 'retire', id: A },
      ],
      entries: [{ op: 'add', collectionId: C, body: '讲梯度时要和已有的反向传播卡对照' }],
    });
    expect(linked.ok).toBe(true);
    const unlabeled = normalizeMemoryRevision({
      summary: '两条新集合',
      collections: [
        { op: 'create', title: '甲', description: '一' },
        { op: 'create', title: '乙', description: '二' },
      ],
      entries: [{ op: 'add', body: '不知道写进哪一个' }],
    });
    expect(unlabeled).toEqual({ ok: false, message: '有多个新建集合时，add 必须传 collectionId' });
  });

  it('rejects missing fields, over-long bodies, and a merge into itself', () => {
    expect(normalizeMemoryRevision({ summary: '  ', collections: [], entries: [] }).ok).toBe(false);
    expect(
      normalizeMemoryRevision({
        summary: '停用',
        collections: [{ op: 'retire' }],
        entries: [],
      }).ok,
    ).toBe(false);
    expect(
      normalizeMemoryRevision({
        summary: '合并',
        collections: [{ op: 'merge', intoId: A, sourceIds: [A] }],
        entries: [],
      }).ok,
    ).toBe(false);
    expect(
      normalizeMemoryRevision({
        summary: '改描述',
        collections: [{ op: 'update', id: A }],
        entries: [],
      }).ok,
    ).toBe(false);
    const tooLong = normalizeMemoryRevision({
      summary: '太长',
      collections: [],
      entries: [{ op: 'add', collectionId: A, body: '字'.repeat(501) }],
    });
    expect(tooLong).toEqual({ ok: false, message: '条目正文超过 500 字' });
  });
});
