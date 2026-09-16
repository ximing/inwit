import type { ReviewFeedback, ReviewSettings, ReviewStats } from '@inwit/dto';

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

export function shiftLocalDateKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

export function applyReviewQueueLimits<T extends { reps: number }>(
  due: T[],
  settings: Pick<ReviewSettings, 'dailyReviewLimit' | 'dailyNewLimit'>,
): { selected: T[]; truncated: number } {
  const news = due.filter((row) => row.reps === 0);
  const reviews = due.filter((row) => row.reps > 0);
  const newCap = Math.min(settings.dailyNewLimit, settings.dailyReviewLimit);
  const selectedNews = news.slice(0, newCap);
  const reviewCap = Math.max(0, settings.dailyReviewLimit - selectedNews.length);
  const selectedReviews = reviews.slice(0, reviewCap);
  const selected = [...selectedNews, ...selectedReviews];
  return { selected, truncated: due.length - selected.length };
}

export function computeStreak(
  reviewDays: Iterable<string>,
  now: Date,
): { current: number; longest: number } {
  const days = new Set(reviewDays);
  if (days.size === 0) return { current: 0, longest: 0 };

  const today = localDateKey(now);
  const yesterday = shiftLocalDateKey(today, -1);
  let current = 0;
  if (days.has(today) || days.has(yesterday)) {
    let cursor = days.has(today) ? today : yesterday;
    while (days.has(cursor)) {
      current += 1;
      cursor = shiftLocalDateKey(cursor, -1);
    }
  }

  const sorted = [...days].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (shiftLocalDateKey(prev, 1) === cur) run += 1;
    else run = 1;
    if (run > longest) longest = run;
  }

  return { current, longest: Math.max(longest, current) };
}

export function buildDailyDistribution(
  logs: Array<{ reviewedAt: Date; feedback: ReviewFeedback }>,
  now: Date,
): ReviewStats['daily'] {
  const from = startOfLocalDayDaysAgo(now, 6);
  const to = endOfLocalDay(now);
  const daily: ReviewStats['daily'] = [];
  for (let i = 0; i < 7; i++) {
    daily.push({
      date: localDateKey(addLocalDays(from, i)),
      forgot: 0,
      fuzzy: 0,
      remembered: 0,
    });
  }
  const byDate = new Map(daily.map((row) => [row.date, row]));
  for (const log of logs) {
    if (log.reviewedAt < from || log.reviewedAt > to) continue;
    const row = byDate.get(localDateKey(log.reviewedAt));
    if (row) row[log.feedback] += 1;
  }
  return daily;
}

export function aggregateLast7Days(daily: ReviewStats['daily']): ReviewStats['last7Days'] {
  const last7Days: ReviewStats['last7Days'] = { forgot: 0, fuzzy: 0, remembered: 0, total: 0 };
  for (const row of daily) {
    last7Days.forgot += row.forgot;
    last7Days.fuzzy += row.fuzzy;
    last7Days.remembered += row.remembered;
    last7Days.total += row.forgot + row.fuzzy + row.remembered;
  }
  return last7Days;
}

export function retentionPercent(remembered: number, total: number): number | null {
  if (total === 0) return null;
  return Math.round((remembered / total) * 100);
}

export function buildForecast(dueAts: Date[], now: Date): ReviewStats['forecast'] {
  const startToday = startOfLocalDay(now);
  const forecast: ReviewStats['forecast'] = [];
  for (let i = 0; i < 7; i++) {
    forecast.push({ date: localDateKey(addLocalDays(startToday, i)), count: 0 });
  }
  const endLast = endOfLocalDay(addLocalDays(now, 6));
  const todayKey = forecast[0]?.date;
  const byDate = new Map(forecast.map((row) => [row.date, row]));
  for (const dueAt of dueAts) {
    if (dueAt > endLast) continue;
    const key = dueAt < startToday ? todayKey : localDateKey(dueAt);
    const row = key ? byDate.get(key) : undefined;
    if (row) row.count += 1;
  }
  return forecast;
}
