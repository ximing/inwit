import type { SearchResult } from '@inwit/dto';
import { request } from './client';

export function searchQuery(
  q: string,
  init?: RequestInit & { topicId?: string | null },
): Promise<SearchResult> {
  const { topicId, ...rest } = init ?? {};
  const params = new URLSearchParams({ q: q.trim() });
  if (topicId) params.set('topicId', topicId);
  return request<SearchResult>(`/api/search?${params.toString()}`, rest);
}
