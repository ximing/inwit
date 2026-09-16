import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors.js';
import { registerErrorHandler } from '../plugins/error-handler.js';
import '../types.js';

vi.mock('../auth/authenticate.js', () => ({
  requireUser: (req: { user?: { id: string } }) => {
    if (!req.user) throw new Error('unauthenticated');
    return req.user;
  },
}));

vi.mock('../auth/access-tokens.js', () => ({
  listAccessTokens: vi.fn(),
  createAccessToken: vi.fn(),
  revealAccessToken: vi.fn(),
  listAccessTokenLogs: vi.fn(),
}));

vi.mock('./users.service.js', () => ({
  updateProfile: vi.fn(),
  requestAvatarUpload: vi.fn(),
  confirmAvatar: vi.fn(),
}));

import {
  createAccessToken,
  listAccessTokenLogs,
  listAccessTokens,
  revealAccessToken,
} from '../auth/access-tokens.js';
import { registerUserRoutes } from './users.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: USER_ID };
  });
  registerErrorHandler(app);
  registerUserRoutes(app);
  return app;
}

describe('access token routes', () => {
  const sample = {
    id: '33333333-3333-4333-8333-333333333333',
    name: '脚本',
    preview: 'iwt_abcd***WXYZ',
    createdAt: '2026-09-16T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.mocked(listAccessTokens).mockReset();
    vi.mocked(createAccessToken).mockReset();
    vi.mocked(revealAccessToken).mockReset();
    vi.mocked(listAccessTokenLogs).mockReset();
  });

  it('GET /api/me/access-tokens lists tokens', async () => {
    vi.mocked(listAccessTokens).mockResolvedValue([sample]);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/me/access-tokens' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([sample]);
    expect(listAccessTokens).toHaveBeenCalledWith(USER_ID);
    await app.close();
  });

  it('POST /api/me/access-tokens requires a name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/access-tokens',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(createAccessToken).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST /api/me/access-tokens creates a named token', async () => {
    vi.mocked(createAccessToken).mockResolvedValue(sample);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/access-tokens',
      payload: { name: '脚本' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(sample);
    expect(createAccessToken).toHaveBeenCalledWith(USER_ID, { name: '脚本' });
    await app.close();
  });

  it('POST /api/me/access-tokens/:id/reveal returns the secret', async () => {
    vi.mocked(revealAccessToken).mockResolvedValue({ token: 'iwt_secret' });
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/me/access-tokens/${sample.id}/reveal`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: 'iwt_secret' });
    expect(revealAccessToken).toHaveBeenCalledWith(USER_ID, sample.id);
    await app.close();
  });

  it('GET /api/me/access-token-logs parses pagination', async () => {
    const page = { items: [], total: 0, limit: 20, offset: 0 };
    vi.mocked(listAccessTokenLogs).mockResolvedValue(page);
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/me/access-token-logs?limit=20' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(page);
    expect(listAccessTokenLogs).toHaveBeenCalledWith(USER_ID, {
      limit: 20,
      offset: 0,
    });
    await app.close();
  });

  it('POST /api/me/access-tokens returns 400 at the cap', async () => {
    vi.mocked(createAccessToken).mockRejectedValue(AppError.of(400, 'ACCESS_TOKEN_LIMIT'));
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/me/access-tokens',
      payload: { name: '满了' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ACCESS_TOKEN_LIMIT');
    await app.close();
  });
});
