export function startOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfLocalDay(now: Date): Date {
  const d = new Date(now.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addLocalDays(now: Date, days: number): Date {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfLocalDayDaysAgo(now: Date, days: number): Date {
  return addLocalDays(startOfLocalDay(now), -days);
}

export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
