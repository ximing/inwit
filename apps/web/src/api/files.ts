import type { StorageFilesQuery, StorageFilesResponse } from '@inwit/dto';
import { request } from './client';

export function listStorageFiles(query: StorageFilesQuery): Promise<StorageFilesResponse> {
  const params = new URLSearchParams({
    kind: query.kind,
    unused: query.unused,
    sort: query.sort,
    limit: String(query.limit),
    offset: String(query.offset),
  });
  return request<StorageFilesResponse>(`/api/me/files?${params.toString()}`);
}
