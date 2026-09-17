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

vi.mock('./search.service.js', () => ({
  search: vi.fn(),
}));

import { registerSearchRoutes } from './search.routes.js';
import { search } from './search.service.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: USER_ID };
  });
  registerErrorHandler(app);
  registerSearchRoutes(app);
  return app;
}

const sample = {
  documents: [],
  cards: [],
  annotations: [],
};

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.mocked(search).mockReset();
    vi.mocked(search).mockResolvedValue(sample);
  });

  it('returns hybrid hits with default limit 8', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=光合作用' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(sample);
    expect(search).toHaveBeenCalledWith(USER_ID, { q: '光合作用', limit: 8 });
    await app.close();
  });

  it('forwards an explicit limit', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=光合&limit=3' });
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith(USER_ID, { q: '光合', limit: 3 });
    await app.close();
  });

  it('forwards a topicId to scope hybrid search', async () => {
    const app = await buildTestApp();
    const topicId = '22222222-2222-4222-8222-222222222222';
    const res = await app.inject({
      method: 'GET',
      url: `/api/search?q=光合&topicId=${topicId}`,
    });
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledWith(USER_ID, { q: '光合', limit: 8, topicId });
    await app.close();
  });

  it('rejects a malformed topicId with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/search?q=光合&topicId=not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a missing q with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/search' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects an empty or whitespace q with 400', async () => {
    const app = await buildTestApp();
    const empty = await app.inject({ method: 'GET', url: '/api/search?q=' });
    const blank = await app.inject({ method: 'GET', url: '/api/search?q=%20%20' });
    expect(empty.statusCode).toBe(400);
    expect(blank.statusCode).toBe(400);
    expect(search).not.toHaveBeenCalled();
    await app.close();
  });
});
