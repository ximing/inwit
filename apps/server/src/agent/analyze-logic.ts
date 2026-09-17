import { DOCUMENT_TITLE_MAX, type MemoryContent } from '@inwit/dto';
import { MS_PER_DAY } from '../review/sm2.js';

export const ANALYZE_ACTION = 'analyze_patterns' as const;
export const ANALYZE_DAILY_THRESHOLD = 3;
export const ANALYZE_STRUGGLING_MIN_HITS = 2;
export const ANALYZE_STRUGGLING_MIN_CARDS = 2;
export const ANALYZE_DEBOUNCE_MS = 15_000;
export const ANALYZE_LOOKBACK_DAYS = 30;
export const ANALYZE_DOC_COOLDOWN_DAYS = 30;
export const ANALYZE_MAX_DOCUMENTS = 1;
export const ANALYZE_MIN_CARDS = 2;
export const ANALYZE_MAX_CARDS = 3;
export const CONFUSABLE_MEMORY_PREFIX = 'confusable:';
export const CONFUSABLE_LINK_TYPE = 'confusable' as const;

export function truncateChars(value: string, max: number): string {
  const chars = [...value.trim()];
  if (chars.length <= max) return chars.join('');
  return chars.slice(0, Math.max(0, max)).join('');
}

export function confusableMemoryKey(cardIdA: string, cardIdB: string): string {
  const [a, b] = [cardIdA, cardIdB].slice().sort();
  return `${CONFUSABLE_MEMORY_PREFIX}${a}+${b}`;
}

export function parseConfusableKey(key: string): { a: string; b: string } | null {
  if (!key.startsWith(CONFUSABLE_MEMORY_PREFIX)) return null;
  const rest = key.slice(CONFUSABLE_MEMORY_PREFIX.length);
  const plus = rest.indexOf('+');
  if (plus <= 0 || plus === rest.length - 1) return null;
  const a = rest.slice(0, plus);
  const b = rest.slice(plus + 1);
  if (!a || !b || a.includes('+') || b.includes('+')) return null;
  return { a, b };
}

export function contrastDocTitle(conceptA: string, conceptB: string): string {
  const prefix = '对比专题：';
  const sep = ' vs ';
  const budget = DOCUMENT_TITLE_MAX - [...prefix].length - [...sep].length;
  const left = Math.max(1, Math.floor(budget / 2));
  const right = Math.max(1, budget - left);
  return `${prefix}${truncateChars(conceptA, left)}${sep}${truncateChars(conceptB, right)}`;
}

export function capDocumentTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return '对比专题';
  return truncateChars(trimmed, DOCUMENT_TITLE_MAX);
}

export function documentOnCooldown(
  content: MemoryContent | undefined | null,
  now: Date,
  windowMs = ANALYZE_DOC_COOLDOWN_DAYS * MS_PER_DAY,
): boolean {
  const documentId = typeof content?.documentId === 'string' ? content.documentId : '';
  if (!documentId) return false;
  const raw = content?.generatedAt;
  const generatedAt = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(generatedAt)) return false;
  return now.getTime() - generatedAt < windowMs;
}

export function shouldEnqueueDailyAnalyze(
  todayStruggleCount: number,
  strugglingCardCount: number,
  alreadyQueued: boolean,
): boolean {
  return (
    todayStruggleCount >= ANALYZE_DAILY_THRESHOLD &&
    strugglingCardCount >= ANALYZE_STRUGGLING_MIN_CARDS &&
    !alreadyQueued
  );
}

export function eligibleContrastPairs(
  cardIds: readonly string[],
  cooldownKeys: ReadonlySet<string>,
): string[] {
  const ids = [...cardIds];
  const keys: string[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      if (!a || !b) continue;
      const key = confusableMemoryKey(a, b);
      if (!cooldownKeys.has(key)) keys.push(key);
    }
  }
  return keys;
}

export function analyzeResultSummary(input: {
  skipped?: 'too_few' | 'cooldown';
  struggling: number;
  pairs: number;
  document: boolean;
  cards: number;
  memory: number;
}): string {
  if (input.skipped === 'too_few') {
    return `action=analyze_patterns skipped=too_few cards=${String(input.struggling)}`;
  }
  if (input.skipped === 'cooldown') {
    return `action=analyze_patterns skipped=cooldown pairs=${String(input.pairs)} memory=${String(input.memory)}`;
  }
  return `action=analyze_patterns pairs=${String(input.pairs)} document=${input.document ? '1' : '0'} cards=${String(input.cards)} memory=${String(input.memory)}`;
}
