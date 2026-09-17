export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

/** Local calendar line used on Today, e.g. `9月14日 星期日`. */
export function formatTodayLong(date = new Date()): string {
  const weekday = WEEKDAYS[date.getDay()] ?? '星期日';
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
}

/** 时段问候（含句号）：上午 5–12 / 下午 12–18 / 其余为晚上。 */
export function dayGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return '上午好。';
  if (hour >= 12 && hour < 18) return '下午好。';
  return '晚上好。';
}

function startOfLocalDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diff = Math.max(0, now - date.getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(date.getTime())) / 86_400_000);
  if (days === 1) return '昨天';
  if (days > 1 && days < 7) return `${days} 天前`;
  return formatDate(iso);
}

export function formatDueAt(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const days = Math.round((startOfLocalDay(date.getTime()) - startOfLocalDay(now)) / 86_400_000);
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === -1) return '昨天';
  if (days > 1 && days < 7) return `${days} 天后`;
  if (days < -1 && days > -7) return `${-days} 天前`;
  return formatDate(iso);
}

export function formatIntervalDays(days: number): string {
  return `间隔 ${days} 天`;
}

/** Mastery bar fill 1–4 from SM-2 intervalDays. */
export function masteryLevel(intervalDays: number): 1 | 2 | 3 | 4 {
  if (intervalDays < 3) return 1;
  if (intervalDays < 7) return 2;
  if (intervalDays < 21) return 3;
  return 4;
}

/** Mini-card footer: 明天再见 / N 天后再问. */
export function formatNextReview(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const days = Math.round((startOfLocalDay(date.getTime()) - startOfLocalDay(now)) / 86_400_000);
  if (days <= 0) return '今天再问';
  if (days === 1) return '明天再见';
  return `${days} 天后再问`;
}

export function formatTimeHm(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function summarizeAnswer(answer: string, max = 48): string {
  const plain = answer
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...plain];
  if (chars.length <= max) return plain;
  return `${chars.slice(0, max).join('')}…`;
}

export function isSubmitHotkey(event: { key: string; metaKey: boolean; ctrlKey: boolean; nativeEvent: { isComposing?: boolean } }): boolean {
  if (event.nativeEvent.isComposing) return false;
  return event.key === 'Enter' && (event.metaKey || event.ctrlKey);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${String(minutes)}m ${String(rem)}s`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatCost(n: number): string {
  if (n === 0) return '$0';
  if (n > 0 && n < 0.0001) return `$${n.toExponential(2)}`;
  return `$${n.toFixed(4)}`;
}

