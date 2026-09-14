import type { Job } from '@inwit/dto';
import { request } from './client';

export function getJob(id: string): Promise<Job> {
  return request<Job>(`/api/jobs/${id}`);
}
