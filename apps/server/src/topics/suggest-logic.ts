import type { TopicSuggestionContent, TopicSuggestionStatus } from '@inwit/dto';
import {
  TOPIC_SUGGESTION_DISMISS_DAYS,
  TOPIC_SUGGESTION_EXPIRE_DAYS,
  TOPIC_SUGGESTION_KEY_PREFIX,
  TOPIC_SUGGESTION_LOOKBACK_DAYS,
  TOPIC_SUGGESTION_MIN_DOCS,
  topicSuggestionContentSchema,
  topicSuggestionSlugSchema,
} from '@inwit/dto';

export const SUGGEST_LOOKBACK_MS = TOPIC_SUGGESTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
export const SUGGEST_DISMISS_MS = TOPIC_SUGGESTION_DISMISS_DAYS * 24 * 60 * 60 * 1000;
export const SUGGEST_EXPIRE_MS = TOPIC_SUGGESTION_EXPIRE_DAYS * 24 * 60 * 60 * 1000;

const SLUG_FALLBACK_RE = /^[a-z][a-z0-9-]{1,78}$/;

export interface SuggestionMemoryView {
  key: string;
  title: string;
  status: TopicSuggestionStatus;
  documentIds: string[];
  dismissedAt: string | null;
  createdAt: Date;
}

export type SuggestionWriteDecision = { ok: true } | { ok: false; reason: string };

export function suggestionKeyFromSlug(slug: string): string {
  return `${TOPIC_SUGGESTION_KEY_PREFIX}${slug}`;
}

export function slugifySuggestionTitle(title: string): string {
  const ascii = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
  if (SLUG_FALLBACK_RE.test(ascii)) return ascii;
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  const hex = Math.abs(hash).toString(16).padStart(6, '0').slice(0, 8);
  return `topic-${hex}`;
}

export function normalizeSuggestionTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/'"`""''·.,，。:：;；!！?？()（）[\]【】]/g, '');
}

export function titlesOverlap(a: string, b: string): boolean {
  const left = normalizeSuggestionTitle(a);
  const right = normalizeSuggestionTitle(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 4 && right.includes(left)) return true;
  if (right.length >= 4 && left.includes(right)) return true;
  return false;
}

export function documentOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  let n = 0;
  for (const id of b) {
    if (set.has(id)) n += 1;
  }
  return n;
}

export function parseSuggestionContent(value: unknown): TopicSuggestionContent | null {
  const parsed = topicSuggestionContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sameCluster(
  candidate: { key: string; title: string; documentIds: string[] },
  existing: SuggestionMemoryView,
): boolean {
  if (existing.key === candidate.key) return true;
  if (titlesOverlap(candidate.title, existing.title)) return true;
  return documentOverlap(candidate.documentIds, existing.documentIds) >= 3;
}

function dismissedAtMs(row: SuggestionMemoryView): number | null {
  if (row.status !== 'dismissed') return null;
  if (row.dismissedAt) {
    const ms = Date.parse(row.dismissedAt);
    return Number.isNaN(ms) ? row.createdAt.getTime() : ms;
  }
  return row.createdAt.getTime();
}

export function decideSuggestionWrite(input: {
  title: string;
  slug: string;
  documentIds: string[];
  now: Date;
  existing: SuggestionMemoryView[];
  activeTopicTitles: string[];
}): SuggestionWriteDecision {
  if (input.documentIds.length < TOPIC_SUGGESTION_MIN_DOCS) {
    return { ok: false, reason: `need at least ${String(TOPIC_SUGGESTION_MIN_DOCS)} documents` };
  }
  const slug = topicSuggestionSlugSchema.safeParse(input.slug);
  if (!slug.success) return { ok: false, reason: 'invalid slug' };
  const key = suggestionKeyFromSlug(slug.data);
  const candidate = { key, title: input.title, documentIds: input.documentIds };

  for (const title of input.activeTopicTitles) {
    if (titlesOverlap(input.title, title)) {
      return { ok: false, reason: 'active topic already covers this cluster' };
    }
  }

  const nowMs = input.now.getTime();
  for (const row of input.existing) {
    if (!sameCluster(candidate, row)) continue;
    if (row.status === 'accepted') {
      return { ok: false, reason: 'already accepted' };
    }
    if (row.status === 'pending') {
      const age = nowMs - row.createdAt.getTime();
      if (age <= SUGGEST_EXPIRE_MS) return { ok: false, reason: 'already pending' };
      const expiredAt = row.createdAt.getTime() + SUGGEST_EXPIRE_MS;
      if (nowMs - expiredAt < SUGGEST_DISMISS_MS) {
        return { ok: false, reason: 'dismissed recently' };
      }
      continue;
    }
    const dismissedMs = dismissedAtMs(row);
    if (dismissedMs !== null && nowMs - dismissedMs < SUGGEST_DISMISS_MS) {
      return { ok: false, reason: 'dismissed recently' };
    }
  }
  return { ok: true };
}
