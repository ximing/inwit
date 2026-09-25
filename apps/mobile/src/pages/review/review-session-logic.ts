import type { ReviewFeedback, ReviewQueueItem, ReviewToday } from '@inwit/dto';
import { maskCloze, stripCloze } from '@/lib/cloze';

/**
 * 复习 Session 状态机（纯函数）。
 *
 * 与 web `apps/web/src/pages/review/review.service.ts` 一一对应：
 * - `current` = `items[0]`
 * - `flip()`：有 current 且非 grading 时翻转 `flipped`（正 ↔ 背）
 * - `grade(feedback)`：必须已翻面且非 grading；成功后
 *   `reviewedToday += 1`、`items = items.slice(1)`、`flipped = false`
 * - `items.length === 0` → 完成页（「今天刷完了」或「今天没有到期的卡片」）
 *   + 明天到期数 `stats.forecast[1].count`
 * - 正面 question = `maskCloze(questions[0].question ?? concept)`（`{{...}}` 遮成 ……）
 * - 背面 answer = `stripCloze(questions[0].answer)`，否则 example + confusionPoint
 * - 面包屑 crumb = `mapPlacement.topicTitle · nodePath`
 */
export type SessionPhase = 'front' | 'back' | 'complete';

export type SessionState = {
  items: ReviewQueueItem[];
  reviewedToday: number;
  total: number;
  flipped: boolean;
  lastFeedback: ReviewFeedback | null;
};

export function emptySession(): SessionState {
  return { items: [], reviewedToday: 0, total: 0, flipped: false, lastFeedback: null };
}

export function applyToday(today: ReviewToday): SessionState {
  return {
    items: today.items,
    reviewedToday: today.reviewedToday,
    total: today.total,
    flipped: false,
    lastFeedback: null,
  };
}

export function currentItem(state: SessionState): ReviewQueueItem | null {
  return state.items[0] ?? null;
}

export function sessionPhase(state: SessionState): SessionPhase {
  if (state.items.length === 0) return 'complete';
  return state.flipped ? 'back' : 'front';
}

export function dueCountOf(state: Pick<SessionState, 'total' | 'reviewedToday'>): number {
  return Math.max(0, state.total - state.reviewedToday);
}

export function cardOrdinal(state: Pick<SessionState, 'items' | 'reviewedToday' | 'total'>): number {
  if (state.total <= 0) return 0;
  if (state.items.length === 0) return state.total;
  return Math.min(state.total, state.reviewedToday + 1);
}

export function progressPct(state: Pick<SessionState, 'items' | 'reviewedToday' | 'total'>): number {
  if (state.total <= 0) return 0;
  return Math.min(100, (cardOrdinal(state) / state.total) * 100);
}

export function canFlip(state: SessionState, grading: boolean): boolean {
  return currentItem(state) !== null && !grading;
}

export function applyFlip(state: SessionState): SessionState {
  if (currentItem(state) === null) return state;
  return { ...state, flipped: !state.flipped };
}

export function canGrade(state: SessionState, grading: boolean): boolean {
  return currentItem(state) !== null && state.flipped && !grading;
}

export function applyGradeStart(state: SessionState, feedback: ReviewFeedback): SessionState {
  return { ...state, lastFeedback: feedback };
}

export function applyGradeSuccess(state: SessionState): SessionState {
  return {
    ...state,
    reviewedToday: state.reviewedToday + 1,
    items: state.items.slice(1),
    flipped: false,
    lastFeedback: null,
  };
}

export function applyGradeFailure(state: SessionState): SessionState {
  return { ...state, lastFeedback: null };
}

/** Drop the current card without recording a grade or counting it as reviewed. */
export function applyRemoveCurrent(state: SessionState): SessionState {
  if (currentItem(state) === null) return state;
  return {
    ...state,
    items: state.items.slice(1),
    total: Math.max(state.reviewedToday, state.total - 1),
    flipped: false,
    lastFeedback: null,
  };
}

export function sessionQuestion(item: ReviewQueueItem | null): string {
  if (!item) return '';
  const first = item.card.questions[0];
  return maskCloze(first?.question ?? item.card.concept);
}

export function sessionAnswer(item: ReviewQueueItem | null): string {
  if (!item) return '';
  const first = item.card.questions[0];
  if (first) return stripCloze(first.answer);
  const parts = [item.card.example, item.card.confusionPoint].filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : item.card.concept;
}

export function sessionCrumb(item: ReviewQueueItem | null): string | null {
  const placement = item?.mapPlacement;
  if (!placement) return null;
  return `${placement.topicTitle} · ${placement.nodePath}`;
}

export function hasSource(item: ReviewQueueItem | null): boolean {
  return item?.card.documentId != null;
}

export function completeTitle(reviewedToday: number): string {
  return reviewedToday > 0 ? '今天刷完了' : '今天没有到期的卡片';
}
