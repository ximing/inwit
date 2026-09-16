import type { SearchResult } from '@inwit/dto';
import { request } from './client';

export function searchQuery(q: string, init?: RequestInit): Promise<SearchResult> {
  const params = new URLSearchParams({ q: q.trim() });
  return request<SearchResult>(`/api/search?${params.toString()}`, init);
}
