import type { ConversationDetail } from '@inwit/dto';
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

vi.mock('./conversation.service.js', () => ({
  listConversations: vi.fn(),
  getConversation: vi.fn(),
  deleteConversation: vi.fn(),
  sendConversationMessage: vi.fn(),
  retryConversationMessage: vi.fn(),
  stopConversation: vi.fn(),
}));

import { stopConversation } from './conversation.service.js';
import { registerConversationRoutes } from './conversation.routes.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (req) => {
    req.user = { id: USER_ID };
  });
  registerErrorHandler(app);
  registerConversationRoutes(app);
  return app;
}

describe('conversation routes', () => {
  beforeEach(() => {
    vi.mocked(stopConversation).mockReset();
  });

  it('POST /api/conversations/:id/stop stops the pending reply', async () => {
    const detail = {
      id: CONVERSATION_ID,
      title: '线性代数',
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      messages: [],
    } as ConversationDetail;
    vi.mocked(stopConversation).mockResolvedValue(detail);
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/conversations/${CONVERSATION_ID}/stop`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(detail);
    expect(stopConversation).toHaveBeenCalledWith(USER_ID, CONVERSATION_ID);
    await app.close();
  });
});
