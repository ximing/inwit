export type CheckinLevel = 0 | 1 | 2 | 3;

export type CheckinCell =
  | { kind: 'lead' | 'trail'; key: string }
  | {
      kind: 'day';
      key: string;
      day: number;
      date: string;
      count: number;
      level: CheckinLevel;
      isToday: boolean;
    };

export function checkinLevel(count: number): CheckinLevel {
  if (count <= 0) return 0;
  if (count <= 4) return 1;
  if (count <= 8) return 2;
  return 3;
}

/** Local calendar month, `YYYY-MM`. */
export function monthKeyOf(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonthKey(month: string, delta: number): string {
  const [year = 1970, mon = 1] = month.split('-').map(Number);
  return monthKeyOf(new Date(year, mon - 1 + delta, 1));
}

export function isCurrentMonth(month: string, today: Date): boolean {
  return month === monthKeyOf(today);
}

export function countsByDate(days: readonly { date: string; count: number }[]): Record<string, number> {
  return Object.fromEntries(days.map((day) => [day.date, day.count]));
}

/**
 * Monday-first month grid.
 * The current month stops at today. Past months show every day.
 * Lead blanks pad the first week. Trailing blanks finish the last week that
 * still has a visible day, and do not add another empty week.
 */
export function buildCheckinGrid(input: {
  month: string;
  counts: Record<string, number>;
  today: Date;
}): {
  cells: CheckinCell[];
  checkinDays: number;
  year: number;
  month: number;
  canGoForward: boolean;
} {
  const [year = 1970, mon = 1] = input.month.split('-').map(Number);
  const today = input.today;
  const current = isCurrentMonth(input.month, today);
  const monthStart = new Date(year, mon - 1, 1).getTime();
  const todayMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const canGoForward = monthStart < todayMonthStart;
  if (monthStart > todayMonthStart) {
    return { cells: [], checkinDays: 0, year, month: mon, canGoForward: false };
  }
  const lastVisible = current ? today.getDate() : new Date(year, mon, 0).getDate();
  const lead = (new Date(year, mon - 1, 1).getDay() + 6) % 7;
  const cells: CheckinCell[] = [];
  for (let i = 0; i < lead; i += 1) cells.push({ kind: 'lead', key: `lead-${String(i)}` });
  let checkinDays = 0;
  for (let day = 1; day <= lastVisible; day += 1) {
    const date = `${input.month}-${String(day).padStart(2, '0')}`;
    const count = input.counts[date] ?? 0;
    if (count > 0) checkinDays += 1;
    cells.push({
      kind: 'day',
      key: date,
      day,
      date,
      count,
      level: checkinLevel(count),
      isToday: current && day === today.getDate(),
    });
  }
  const trailing = (7 - ((lead + lastVisible) % 7)) % 7;
  for (let i = 0; i < trailing; i += 1) cells.push({ kind: 'trail', key: `trail-${String(i)}` });
  return { cells, checkinDays, year, month: mon, canGoForward };
}
