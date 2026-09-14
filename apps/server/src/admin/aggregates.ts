import type { UsageDay, UsageTotals } from '@inwit/dto';

export function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export function roundCost(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}

export function emptyTotals(): UsageTotals {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costEstimate: 0 };
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function usageWindow(days: number, now = new Date()): { from: Date; to: Date } {
  const to = startOfUtcDay(now);
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from, to };
}

export function enumerateUtcDates(from: Date, days: number): string[] {
  const start = startOfUtcDay(from);
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i));
    keys.push(utcDateKey(d));
  }
  return keys;
}

const EMPTY_DAY = {
  calls: 0,
  totalTokens: 0,
  costEstimate: 0,
  chatTokens: 0,
  embedTokens: 0,
  rerankTokens: 0,
} as const;

export function fillDailySeries(from: Date, days: number, rows: UsageDay[]): UsageDay[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return enumerateUtcDates(from, days).map((date) => {
    const hit = byDate.get(date);
    return hit ?? { date, ...EMPTY_DAY };
  });
}

export function elapsedMs(
  startedAt: Date,
  finishedAt: Date | null,
  running: boolean,
  now = new Date(),
): number | null {
  if (finishedAt) return Math.max(0, finishedAt.getTime() - startedAt.getTime());
  if (running) return Math.max(0, now.getTime() - startedAt.getTime());
  return null;
}

export function previewText(value: string | null | undefined, max = 80): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

export function addTotals(into: UsageTotals, next: UsageTotals): void {
  into.calls += next.calls;
  into.promptTokens += next.promptTokens;
  into.completionTokens += next.completionTokens;
  into.totalTokens += next.totalTokens;
  into.costEstimate = roundCost(into.costEstimate + next.costEstimate);
}
