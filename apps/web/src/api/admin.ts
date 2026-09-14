import type {
  AdminExecutionDetail,
  AdminExecutionListItem,
  Job,
  JobStatus,
  JobType,
  Paged,
  UsageSummary,
  AgentExecutionStatus,
  AgentType,
} from '@inwit/dto';
import { request } from './client';

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text.length > 0 ? `?${text}` : '';
}

export function listAdminJobs(query: {
  status?: JobStatus;
  type?: JobType;
  page?: number;
  limit?: number;
}): Promise<Paged<Job>> {
  return request<Paged<Job>>(
    `/api/admin/jobs${qs({
      status: query.status,
      type: query.type,
      page: query.page,
      limit: query.limit,
    })}`,
  );
}

export function retryAdminJob(id: string): Promise<Job> {
  return request<Job>(`/api/admin/jobs/${id}/retry`, { method: 'POST' });
}

export function getUsageSummary(days = 30): Promise<UsageSummary> {
  return request<UsageSummary>(`/api/admin/usage/summary${qs({ days })}`);
}

export function listAdminExecutions(query: {
  agentType?: AgentType;
  status?: AgentExecutionStatus;
  page?: number;
  limit?: number;
}): Promise<Paged<AdminExecutionListItem>> {
  return request<Paged<AdminExecutionListItem>>(
    `/api/admin/executions${qs({
      agentType: query.agentType,
      status: query.status,
      page: query.page,
      limit: query.limit,
    })}`,
  );
}

export function getAdminExecution(id: string): Promise<AdminExecutionDetail> {
  return request<AdminExecutionDetail>(`/api/admin/executions/${id}`);
}
