import { createTopicInputSchema, listTopicsQuerySchema, updateTopicInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  acceptTopicSuggestion,
  dismissTopicSuggestion,
  enqueueSuggestScan,
  listTopicSuggestions,
} from './suggest.js';
import {
  archiveTopic,
  createTopic,
  deleteTopic,
  getTopic,
  listTopics,
  updateTopic,
} from './topic.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const suggestionKeyParamsSchema = z.object({
  key: z.string().trim().min(1).max(200),
});

export function registerTopicRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/topics', auth, async (req) => {
    return listTopics(requireUser(req).id, listTopicsQuerySchema.parse(req.query));
  });

  app.post('/api/topics/suggest-scan', auth, async (req, reply) => {
    const { job, created } = await enqueueSuggestScan(requireUser(req).id, { force: true });
    return reply.code(created ? 201 : 200).send(job);
  });

  app.get('/api/topic-suggestions', auth, async (req) => {
    return listTopicSuggestions(requireUser(req).id);
  });

  app.post('/api/topic-suggestions/:key/accept', auth, async (req) => {
    const { key } = suggestionKeyParamsSchema.parse(req.params);
    return acceptTopicSuggestion(requireUser(req).id, key);
  });

  app.post('/api/topic-suggestions/:key/dismiss', auth, async (req) => {
    const { key } = suggestionKeyParamsSchema.parse(req.params);
    return dismissTopicSuggestion(requireUser(req).id, key);
  });

  app.post('/api/topics', auth, async (req, reply) => {
    const input = createTopicInputSchema.parse(req.body);
    const created = await createTopic(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.get('/api/topics/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getTopic(requireUser(req).id, id);
  });

  app.patch('/api/topics/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateTopicInputSchema.parse(req.body ?? {});
    return updateTopic(requireUser(req).id, id, input);
  });

  app.post('/api/topics/:id/archive', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return archiveTopic(requireUser(req).id, id);
  });

  app.delete('/api/topics/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteTopic(requireUser(req).id, id);
    return reply.code(204).send();
  });
}
