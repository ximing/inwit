import {
  createMapNodeInputSchema,
  setMapNodeInputSchema,
  updateMapNodeInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { setCardMapNode } from '../cards/card.service.js';
import { setDocumentMapNode } from '../documents/document.service.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { enqueueFillMapNodeJob, enqueueOrganizeMapJob, findActiveTopicJob } from './map.jobs.js';
import {
  createMapNode,
  deleteMapNode,
  getMapNodeDetail,
  getTopicMap,
  getTopicMapSummary,
  updateMapNode,
} from './map.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerMapRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/topics/:id/map/summary', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getTopicMapSummary(requireUser(req).id, id);
  });

  app.get('/api/topics/:id/map', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getTopicMap(requireUser(req).id, id);
  });

  app.get('/api/topics/:id/map/job', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const userId = requireUser(req).id;
    await getOwnedTopic(userId, id);
    const job = await findActiveTopicJob(userId, id);
    return { job };
  });

  app.post('/api/topics/:id/map/nodes', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = createMapNodeInputSchema.parse(req.body);
    const created = await createMapNode(requireUser(req).id, id, input);
    return reply.code(201).send(created);
  });

  app.post('/api/topics/:id/map/organize', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const job = await enqueueOrganizeMapJob(requireUser(req).id, id);
    return reply.code(201).send(job);
  });

  app.get('/api/map-nodes/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getMapNodeDetail(requireUser(req).id, id);
  });

  app.patch('/api/map-nodes/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateMapNodeInputSchema.parse(req.body ?? {});
    return updateMapNode(requireUser(req).id, id, input);
  });

  app.delete('/api/map-nodes/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteMapNode(requireUser(req).id, id);
    return reply.code(204).send();
  });

  app.post('/api/map-nodes/:id/fill', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const job = await enqueueFillMapNodeJob(requireUser(req).id, id);
    return reply.code(201).send(job);
  });

  app.put('/api/cards/:id/map-node', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = setMapNodeInputSchema.parse(req.body);
    return setCardMapNode(requireUser(req).id, id, input.nodeId);
  });

  app.put('/api/documents/:id/map-node', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = setMapNodeInputSchema.parse(req.body);
    return setDocumentMapNode(requireUser(req).id, id, input.nodeId);
  });
}
