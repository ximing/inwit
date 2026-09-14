import type { ReviewFeedback, ReviewFeedbackResult, ReviewStats, ReviewToday } from '@inwit/dto';
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
