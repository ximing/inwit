import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerErrorHandler } from '../plugins/error-handler.js';
import '../types.js';

vi.mock('../auth/authenticate.js', () => ({
  requireUser: (req: { user?: { id: string; accessTokenId?: string } }) => {
    if (!req.user) throw new Error('unauthenticated');
    return req.user;
  },
}));

vi.mock('./open-documents.js', () => ({
  createOpenDocument: vi.fn(),
  getOpenDocument: vi.fn(),
}));

import { createOpenDocument, getOpenDocument } from './open-documents.js';
import { registerOpenDocumentsRoutes } from './open-documents.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN_ID = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';

const sample = {
  id: DOC_ID,
  userId: USER_ID,
  topicId: null,
  mapNodeId: null,
  title: '笔记',
  description: null,
  contentJson: { type: 'doc' as const, content: [{ type: 'paragraph' }] },
  source: 'api' as const,
  status: 'pending' as const,
  failReason: null,
  answer: null,
  linkHint: null,
  fileMime: null,
  pageCount: null,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  deletedAt: null,
  markdown: 'hello\n',
  media: { rehosted: 0, failed: [] },
};

async function buildTestApp(accessTokenId?: string) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = accessTokenId ? { id: USER_ID, accessTokenId } : { id: USER_ID };
  });
  registerErrorHandler(app);
  registerOpenDocumentsRoutes(app);
  return app;
}

describe('open document routes', () => {
  beforeEach(() => {
    vi.mocked(createOpenDocument).mockReset();
    vi.mocked(getOpenDocument).mockReset();
  });

  it('POST /api/open/documents creates from markdown', async () => {
    vi.mocked(createOpenDocument).mockResolvedValue(sample);
    const app = await buildTestApp(TOKEN_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/open/documents',
      payload: { title: '笔记', markdown: 'hello' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().markdown).toBe('hello\n');
    expect(createOpenDocument).toHaveBeenCalledWith(
      { id: USER_ID, accessTokenId: TOKEN_ID },
      expect.objectContaining({ title: '笔记', markdown: 'hello' }),
    );
    await app.close();
  });

  it('GET /api/open/documents/:id returns markdown', async () => {
    vi.mocked(getOpenDocument).mockResolvedValue(sample);
    const app = await buildTestApp(TOKEN_ID);
    const res = await app.inject({ method: 'GET', url: `/api/open/documents/${DOC_ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(sample);
    expect(getOpenDocument).toHaveBeenCalledWith({ id: USER_ID, accessTokenId: TOKEN_ID }, DOC_ID);
    await app.close();
  });

  it('POST /api/open/documents creates from html', async () => {
    vi.mocked(createOpenDocument).mockResolvedValue(sample);
    const app = await buildTestApp(TOKEN_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/open/documents',
      payload: { title: '剪藏', html: '<p>hello</p>', sourceUrl: 'https://example.com/a' },
    });
    expect(res.statusCode).toBe(201);
    expect(createOpenDocument).toHaveBeenCalledWith(
      { id: USER_ID, accessTokenId: TOKEN_ID },
      expect.objectContaining({
        title: '剪藏',
        html: '<p>hello</p>',
        sourceUrl: 'https://example.com/a',
      }),
    );
    await app.close();
  });

  it('POST rejects when both markdown and html are present', async () => {
    const app = await buildTestApp(TOKEN_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/open/documents',
      payload: { title: '笔记', markdown: 'a', html: '<p>a</p>' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createOpenDocument).not.toHaveBeenCalled();
    await app.close();
  });

  it('POST rejects when neither markdown nor html is present', async () => {
    const app = await buildTestApp(TOKEN_ID);
    const res = await app.inject({
      method: 'POST',
      url: '/api/open/documents',
      payload: { title: '笔记' },
    });
    expect(res.statusCode).toBe(400);
    expect(createOpenDocument).not.toHaveBeenCalled();
    await app.close();
  });

  it('GET rejects a malformed document id', async () => {
    const app = await buildTestApp(TOKEN_ID);
    const res = await app.inject({ method: 'GET', url: '/api/open/documents/not-a-uuid' });
    expect(res.statusCode).toBe(400);
    expect(getOpenDocument).not.toHaveBeenCalled();
    await app.close();
  });
});
