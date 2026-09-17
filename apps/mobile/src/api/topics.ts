import type {
  AcceptTopicSuggestionResult,
  CreateTopicInput,
  Job,
  Topic,
  TopicSuggestion,
  UpdateTopicInput,
} from '@inwit/dto';
import { request } from './client';

export function getTopic(id: string): Promise<Topic> {
  return request<Topic>(`/api/topics/${id}`);
}

export function listTopics(status?: Topic['status']): Promise<Topic[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return request<Topic[]>(`/api/topics${qs}`);
}

export function createTopic(input: CreateTopicInput): Promise<Topic> {
  return request<Topic>('/api/topics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function archiveTopic(id: string): Promise<Topic> {
  return request<Topic>(`/api/topics/${id}/archive`, { method: 'POST' });
}

export function restoreTopic(id: string): Promise<Topic> {
  return request<Topic>(`/api/topics/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'active' }),
  });
}

export function updateTopic(id: string, input: UpdateTopicInput): Promise<Topic> {
  return request<Topic>(`/api/topics/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteTopic(id: string): Promise<void> {
  return request<void>(`/api/topics/${id}`, { method: 'DELETE' });
}

export function listTopicSuggestions(): Promise<TopicSuggestion[]> {
  return request<TopicSuggestion[]>('/api/topic-suggestions');
}

export function acceptTopicSuggestion(key: string): Promise<AcceptTopicSuggestionResult> {
  return request<AcceptTopicSuggestionResult>(
    `/api/topic-suggestions/${encodeURIComponent(key)}/accept`,
    { method: 'POST' },
  );
}

export function dismissTopicSuggestion(key: string): Promise<TopicSuggestion> {
  return request<TopicSuggestion>(`/api/topic-suggestions/${encodeURIComponent(key)}/dismiss`, {
    method: 'POST',
  });
}

export function scanTopicSuggestions(): Promise<Job> {
  return request<Job>('/api/topics/suggest-scan', { method: 'POST' });
}
