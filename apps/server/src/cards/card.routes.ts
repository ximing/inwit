import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { deleteCardLink, getCard, listCardLinks } from './card.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerCardRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/cards/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getCard(requireUser(req).id, id);
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
