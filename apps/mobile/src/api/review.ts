import type {
  ReviewCheckins,
  ReviewFeedback,
  ReviewFeedbackResult,
  ReviewSettings,
  ReviewStats,
  ReviewStrugglingCard,
  ReviewToday,
  ReviewTopicStat,
} from '@inwit/dto';
import { request } from './client';

export function getReviewToday(): Promise<ReviewToday> {
  // 复习协议 2：受管理卡随队列下发 reviewToken
  return request<ReviewToday>('/api/review/today?reviewProtocol=2');
}

export function submitReviewFeedback(
  cardId: string,
  feedback: ReviewFeedback,
  opts?: { reviewToken?: string; requestId?: string },
): Promise<ReviewFeedbackResult> {
  return request<ReviewFeedbackResult>(`/api/review/${cardId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({
      feedback,
      ...(opts?.reviewToken !== undefined ? { reviewToken: opts.reviewToken } : {}),
      ...(opts?.requestId !== undefined ? { requestId: opts.requestId } : {}),
    }),
  });
}

export function getReviewStats(): Promise<ReviewStats> {
  return request<ReviewStats>('/api/review/stats');
}

export function getReviewTopicStats(): Promise<ReviewTopicStat[]> {
  return request<ReviewTopicStat[]>('/api/review/stats/topics');
}

export function getStrugglingCards(limit = 5): Promise<ReviewStrugglingCard[]> {
  return request<ReviewStrugglingCard[]>(`/api/review/struggling?limit=${String(limit)}`);
}

export function getReviewCheckins(month: string): Promise<ReviewCheckins> {
  return request<ReviewCheckins>(`/api/review/checkins?month=${month}`);
}

export function getReviewSettings(): Promise<ReviewSettings> {
  return request<ReviewSettings>('/api/review/settings');
}

export function updateReviewSettings(settings: ReviewSettings): Promise<ReviewSettings> {
  return request<ReviewSettings>('/api/review/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}
