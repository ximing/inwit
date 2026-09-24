import {
  archiveListQuerySchema,
  createCardInputSchema,
  rejectCardInputSchema,
  updateCardInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { resumeCard, suspendCard } from '../review/review.service.js';
import {
  archiveCard,
  createCard,
  destroyCard,
  deleteCardLink,
  getCard,
  getCardImage,
  listArchivedCards,
  listCardLinks,
  restoreCard,
  updateCard,
} from './card.service.js';
import { acceptCard, rejectCard } from './card-decision.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerCardRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post('/api/cards', auth, async (req, reply) => {
    const input = createCardInputSchema.parse(req.body);
    const created = await createCard(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.get('/api/cards/archived', auth, async (req) => {
    const query = archiveListQuerySchema.parse(req.query ?? {});
    return listArchivedCards(requireUser(req).id, query);
  });

  app.get('/api/cards/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getCard(requireUser(req).id, id);
  });

  app.patch('/api/cards/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateCardInputSchema.parse(req.body);
    return updateCard(requireUser(req).id, id, input);
  });

  /** Soft delete: the card moves to 回收站 and can be restored. */
  app.delete('/api/cards/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await archiveCard(requireUser(req).id, id);
    return reply.code(204).send();
  });

  app.post('/api/cards/:id/restore', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return restoreCard(requireUser(req).id, id);
  });

  app.post('/api/cards/:id/accept', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return acceptCard(requireUser(req).id, id);
  });

  app.post('/api/cards/:id/reject', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = rejectCardInputSchema.parse(req.body ?? {});
    return rejectCard(requireUser(req).id, id, input);
  });

  app.delete('/api/cards/:id/permanent', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await destroyCard(requireUser(req).id, id);
    return reply.code(204).send();
  });

  /** 已熟悉：leave the review queue until the suspend mark is removed. */
  app.post('/api/cards/:id/suspend', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return suspendCard(requireUser(req).id, id);
  });

  app.delete('/api/cards/:id/suspend', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return resumeCard(requireUser(req).id, id);
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
