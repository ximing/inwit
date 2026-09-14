import type { Job, MapNodeDetail, MapSummary, MapTree } from '@inwit/dto';
import { request } from './client';

export function getTopicMap(topicId: string): Promise<MapTree> {
  return request<MapTree>(`/api/topics/${topicId}/map`);
}

export function getTopicMapSummary(topicId: string): Promise<MapSummary> {
  return request<MapSummary>(`/api/topics/${topicId}/map/summary`);
}

export function getActiveTopicJob(topicId: string): Promise<{ job: Job | null }> {
  return request<{ job: Job | null }>(`/api/topics/${topicId}/map/job`);
}

export function organizeTopicMap(topicId: string): Promise<Job> {
  return request<Job>(`/api/topics/${topicId}/map/organize`, { method: 'POST' });
}

export function getMapNodeDetail(nodeId: string): Promise<MapNodeDetail> {
  return request<MapNodeDetail>(`/api/map-nodes/${nodeId}`);
}

export function fillMapNode(nodeId: string): Promise<Job> {
  return request<Job>(`/api/map-nodes/${nodeId}/fill`, { method: 'POST' });
}
