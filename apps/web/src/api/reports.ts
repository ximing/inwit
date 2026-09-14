import type { Job, WeeklyReportLatestResponse } from '@inwit/dto';
import { request } from './client';

export function generateWeeklyReport(): Promise<Job> {
  return request<Job>('/api/reports/weekly/generate', { method: 'POST' });
}

export function getLatestWeeklyReport(): Promise<WeeklyReportLatestResponse> {
  return request<WeeklyReportLatestResponse>('/api/reports/latest');
}
