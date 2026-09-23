import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import '../types.js';

vi.mock('../auth/authenticate.js', () => ({
  requireUser: (req: { user?: { id: string } }) => {
    if (!req.user) throw new Error('unauthenticated');
    return req.user;
  },
}));

vi.mock('./jobs.service.js', () => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
  getJobQueue: vi.fn(),
  getJobUsage: vi.fn(),
  listJobExecutions: vi.fn(),
  retryJob: vi.fn(),
  cancelJob: vi.fn(),
}));

import {
  cancelJob,
  getJob,
  getJobQueue,
  getJobUsage,
  listJobExecutions,
  listJobs,
  retryJob,
} from './jobs.service.js';
import { registerJobRoutes } from './jobs.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: USER_ID };
  });
  registerErrorHandler(app);
  registerJobRoutes(app);
  return app;
}

const sampleJob = {
  id: JOB_ID,
  userId: USER_ID,
  type: 'digest' as const,
  status: 'pending' as const,
  payload: {},
  runAt: '2026-09-14T03:00:00.000Z',
  finishedAt: null,
  attempts: 0,
  lastError: null,
  createdAt: '2026-09-14T02:00:00.000Z',
  updatedAt: '2026-09-14T02:00:00.000Z',
  summary: '消化 · 一篇文档',
  description: '提取知识卡片并更新知识地图',
};

describe('job routes', () => {
  beforeEach(() => {
    vi.mocked(listJobs).mockReset();
    vi.mocked(getJob).mockReset();
    vi.mocked(getJobQueue).mockReset();
    vi.mocked(getJobUsage).mockReset();
    vi.mocked(retryJob).mockReset();
    vi.mocked(cancelJob).mockReset();
    vi.mocked(listJobExecutions).mockReset();
  });

  it('GET /api/jobs/:id/executions returns the per-attempt audit', async () => {
    const executions = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        jobId: JOB_ID,
        userId: USER_ID,
        agentType: 'digest' as const,
        status: 'failed' as const,
        startedAt: '2026-09-14T02:10:00.000Z',
        finishedAt: '2026-09-14T02:11:00.000Z',
        steps: [{ tool: 'write_cards', input_summary: '{}', output_summary: 'ok', duration_ms: 12 }],
        turns: [],
        error: 'digest produced no cards',
        resultSummary: 'cards=0',
        createdAt: '2026-09-14T02:10:00.000Z',
      },
    ];
    vi.mocked(listJobExecutions).mockResolvedValue(executions);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: `/api/jobs/${JOB_ID}/executions` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(executions);
    expect(listJobExecutions).toHaveBeenCalledWith(USER_ID, JOB_ID);
    await app.close();
  });

  it('GET /api/jobs/queue is not captured by /:id', async () => {
    const queue = {
      running: [],
      pending: [{ ...sampleJob, scheduledFor: sampleJob.runAt }],
      counts: { running: 0, pending: 1, doneToday: 9, failed: 1 },
    };
    vi.mocked(getJobQueue).mockResolvedValue(queue);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/jobs/queue' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(queue);
    expect(getJobQueue).toHaveBeenCalledWith(USER_ID);
    expect(getJob).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /api/jobs/usage is not captured by /:id', async () => {
    const usage = {
      daily: [{ date: '2026-09-14', tokens: 10 }],
      byType: [{ type: 'digest', tokens: 10 }],
      total: 10,
    };
    vi.mocked(getJobUsage).mockResolvedValue(usage);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/jobs/usage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(usage);
    expect(getJobUsage).toHaveBeenCalledWith(USER_ID);
    expect(getJob).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET /api/jobs still lists jobs', async () => {
    vi.mocked(listJobs).mockResolvedValue({
      items: [sampleJob],
      total: 1,
      limit: 20,
      offset: 0,
    });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].summary).toBe('消化 · 一篇文档');
    expect(listJobs).toHaveBeenCalledWith(USER_ID, expect.objectContaining({ limit: 20, offset: 0 }));
    await app.close();
  });

  it('POST retry and cancel still resolve :id', async () => {
    vi.mocked(retryJob).mockResolvedValue({ ...sampleJob, status: 'pending' });
    vi.mocked(cancelJob).mockResolvedValue({ ...sampleJob, status: 'failed' });
    const app = await buildTestApp();
    const retry = await app.inject({ method: 'POST', url: `/api/jobs/${JOB_ID}/retry` });
    const cancel = await app.inject({ method: 'POST', url: `/api/jobs/${JOB_ID}/cancel` });
    expect(retry.statusCode).toBe(200);
    expect(cancel.statusCode).toBe(200);
    expect(retryJob).toHaveBeenCalledWith(USER_ID, JOB_ID);
    expect(cancelJob).toHaveBeenCalledWith(USER_ID, JOB_ID);
    await app.close();
  });
});
