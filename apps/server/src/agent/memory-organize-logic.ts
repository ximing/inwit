import { addLocalDays, startOfLocalDay } from '../utils/date.js';

export const ORGANIZE_BATCH_MAX = 12;
export const ORGANIZE_COUNT_THRESHOLD = 12;
export const ORGANIZE_DEBOUNCE_MS = 10 * 60 * 1000;
export const ORGANIZE_SLOT_HOURS = [0, 6, 12, 18] as const;
export const ORGANIZE_DAILY_CAP = 8;

export type MemoryOrganizeTrigger = 'count' | 'slot';

export type MemoryOrganizePending = {
  runAt: Date;
  trigger: MemoryOrganizeTrigger;
};

export type MemoryOrganizePlan =
  | { action: 'skip' }
  | { action: 'enqueue'; runAt: Date; trigger: MemoryOrganizeTrigger }
  | { action: 'postpone'; runAt: Date; trigger: MemoryOrganizeTrigger };

function nextOrganizeSlot(now: Date): Date {
  const start = startOfLocalDay(now);
  for (const hour of ORGANIZE_SLOT_HOURS) {
    const slot = new Date(start.getTime());
    slot.setHours(hour, 0, 0, 0);
    if (slot.getTime() > now.getTime()) return slot;
  }
  return addLocalDays(start, 1);
}

function nextLocalMidnight(now: Date): Date {
  return addLocalDays(startOfLocalDay(now), 1);
}

function schedule(
  pending: MemoryOrganizePending | null,
  runAt: Date,
  trigger: MemoryOrganizeTrigger,
  bound: 'pull-earlier' | 'push-later',
): MemoryOrganizePlan {
  if (pending === null) return { action: 'enqueue', runAt, trigger };
  const pendingAt = pending.runAt.getTime();
  const target = runAt.getTime();
  const move = bound === 'pull-earlier' ? pendingAt > target : pendingAt < target;
  return move ? { action: 'postpone', runAt, trigger } : { action: 'skip' };
}

export function planMemoryOrganize(input: {
  unconsumed: number;
  revisionsToday: number;
  now: Date;
  running: boolean;
  pending: MemoryOrganizePending | null;
}): MemoryOrganizePlan {
  if (input.unconsumed <= 0) return { action: 'skip' };
  if (input.running) return { action: 'skip' };

  if (input.revisionsToday >= ORGANIZE_DAILY_CAP) {
    return schedule(input.pending, nextLocalMidnight(input.now), 'slot', 'push-later');
  }

  if (input.unconsumed >= ORGANIZE_COUNT_THRESHOLD) {
    const runAt = new Date(input.now.getTime() + ORGANIZE_DEBOUNCE_MS);
    return schedule(input.pending, runAt, 'count', 'pull-earlier');
  }

  if (input.pending !== null) return { action: 'skip' };
  return { action: 'enqueue', runAt: nextOrganizeSlot(input.now), trigger: 'slot' };
}
