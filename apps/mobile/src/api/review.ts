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
  return request<ReviewToday>('/api/review/today');
}

export function submitReviewFeedback(
  cardId: string,
  feedback: ReviewFeedback,
): Promise<ReviewFeedbackResult> {
  return request<ReviewFeedbackResult>(`/api/review/${cardId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
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
