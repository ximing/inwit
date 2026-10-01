import {
  listConversationsQuerySchema,
  retryConversationInputSchema,
  sendConversationInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  deleteConversation,
  getConversation,
  listConversations,
  retryConversationMessage,
  sendConversationMessage,
} from './conversation.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const messageParamsSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

export function registerConversationRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/conversations', auth, async (req) => {
    const query = listConversationsQuerySchema.parse(req.query);
    const items = await listConversations(requireUser(req).id, query.limit);
    return { items };
  });

  app.post('/api/conversations', auth, async (req, reply) => {
    const input = sendConversationInputSchema.parse(req.body);
    const created = await sendConversationMessage(requireUser(req).id, null, input);
    return reply.code(201).send(created);
  });

  app.get('/api/conversations/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getConversation(requireUser(req).id, id);
  });

  app.delete('/api/conversations/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteConversation(requireUser(req).id, id);
    return reply.code(204).send();
  });

  app.post('/api/conversations/:id/messages', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = sendConversationInputSchema.parse(req.body);
    const detail = await sendConversationMessage(requireUser(req).id, id, input);
    return reply.code(201).send(detail);
  });

  app.post('/api/conversations/:id/messages/:messageId/retry', auth, async (req) => {
    const { id, messageId } = messageParamsSchema.parse(req.params);
    const input = retryConversationInputSchema.parse(req.body ?? {});
    return retryConversationMessage(requireUser(req).id, id, messageId, input);
  });
}
