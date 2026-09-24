import type { MemoryCollection, MemoryEntry, MemoryRevision, Paginated } from '@inwit/dto';
import { request } from './client';

export function listMemoryCollections(): Promise<{
  collections: MemoryCollection[];
  entries: MemoryEntry[];
}> {
  return request('/api/memory/collections');
}

export function listMemoryRevisions(query: {
  limit?: number;
  offset?: number;
} = {}): Promise<Paginated<MemoryRevision>> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return request(`/api/memory/revisions${qs ? `?${qs}` : ''}`);
}
