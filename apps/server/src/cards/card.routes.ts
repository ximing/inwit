import { createCardInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { createCard, deleteCardLink, getCard, getCardImage, listCardLinks } from './card.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerCardRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post('/api/cards', auth, async (req, reply) => {
    const input = createCardInputSchema.parse(req.body);
    const created = await createCard(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.get('/api/cards/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getCard(requireUser(req).id, id);
  });

  app.get('/api/cards/:id/image', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getCardImage(requireUser(req).id, id);
  });

  app.get('/api/cards/:id/links', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return listCardLinks(requireUser(req).id, id);
  });

  app.delete('/api/card-links/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteCardLink(requireUser(req).id, id);
    return reply.code(204).send();
  });
}
