import type { AgentExecution, Job, JobQueue, JobStatus, JobType, JobUsage, Paginated } from '@inwit/dto';
import { request } from './client';

export function listJobs(query: {
  status?: JobStatus;
  type?: JobType;
  limit?: number;
  offset?: number;
} = {}): Promise<Paginated<Job>> {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return request<Paginated<Job>>(`/api/jobs${qs ? `?${qs}` : ''}`);
}

export function getJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`);
}

/** Per-attempt execution audit (agent_executions) for one job. */
export function listJobExecutions(id: string): Promise<AgentExecution[]> {
  return request<AgentExecution[]>(`/api/jobs/${id}/executions`);
}

export function getJobQueue(): Promise<JobQueue> {
  return request<JobQueue>('/api/jobs/queue');
}

export function getJobUsage(): Promise<JobUsage> {
  return request<JobUsage>('/api/jobs/usage');
}

export function retryJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}/retry`, { method: 'POST' });
}

export function cancelJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}/cancel`, { method: 'POST' });
}
