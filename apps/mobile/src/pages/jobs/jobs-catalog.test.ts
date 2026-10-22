import { JOB_TYPES as DTO_JOB_TYPES } from '@inwit/dto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/sync.service', () => ({
  SyncService: class SyncService {},
}));

vi.mock('@/api/client', () => ({
  ApiError: class ApiError extends Error {
    status = 0;
    code = '';
  },
  errorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('@/api/jobs', () => ({
  cancelJob: vi.fn(),
  getJobQueue: vi.fn(),
  getJobUsage: vi.fn(),
  listJobExecutions: vi.fn(),
  listJobs: vi.fn(),
  retryJob: vi.fn(),
}));

import { JOB_TYPE_LABELS, JOB_TYPES } from './jobs.service.js';

describe('JOB_TYPES catalog', () => {
  it('re-exports the dto list', () => {
    expect(JOB_TYPES).toBe(DTO_JOB_TYPES);
  });

  it('labels every job type', () => {
    for (const type of JOB_TYPES) {
      expect(JOB_TYPE_LABELS[type]?.trim().length).toBeGreaterThan(0);
    }
  });
});
