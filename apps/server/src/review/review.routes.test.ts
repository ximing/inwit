import { DEFAULT_REVIEW_SETTINGS } from '@inwit/dto';
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

vi.mock('./review.service.js', () => ({
  getReviewToday: vi.fn(),
  getReviewStats: vi.fn(),
  submitReviewFeedback: vi.fn(),
  getReviewSettings: vi.fn(),
  updateReviewSettings: vi.fn(),
}));

import { getReviewSettings, updateReviewSettings } from './review.service.js';
import { registerReviewRoutes } from './review.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: USER_ID };
  });
  registerErrorHandler(app);
  registerReviewRoutes(app);
  return app;
}

describe('GET/PUT /api/review/settings', () => {
  beforeEach(() => {
    vi.mocked(getReviewSettings).mockReset();
    vi.mocked(updateReviewSettings).mockReset();
  });

  it('GET returns merged defaults when the service has no stored row', async () => {
    vi.mocked(getReviewSettings).mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/review/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(DEFAULT_REVIEW_SETTINGS);
    expect(getReviewSettings).toHaveBeenCalledWith(USER_ID);
    await app.close();
  });

  it('PUT replaces settings after zod validation', async () => {
    const next = {
      dailyReviewLimit: 30,
      dailyNewLimit: 8,
      startingEase: 2.2,
      fuzzyScale: 1.1,
      learningSteps: [1, 4, 8],
    };
    vi.mocked(updateReviewSettings).mockResolvedValue(next);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/review/settings',
      payload: next,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(next);
    expect(updateReviewSettings).toHaveBeenCalledWith(USER_ID, next);
    await app.close();
  });

  it('PUT rejects an invalid body with VALIDATION_ERROR', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/review/settings',
      payload: { dailyReviewLimit: 20 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(updateReviewSettings).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not treat "settings" as a :cardId', async () => {
    vi.mocked(getReviewSettings).mockResolvedValue({ ...DEFAULT_REVIEW_SETTINGS });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/review/settings' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
