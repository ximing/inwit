import { createLlmConfigInputSchema, updateLlmConfigInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  createLlmConfig,
  deleteLlmConfig,
  listLlmConfigs,
  setDefaultLlmConfig,
  testLlmConfig,
  updateLlmConfig,
} from './llm.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerLlmRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/llm-configs', auth, async (req) => {
    return listLlmConfigs(requireUser(req).id);
  });

  app.post('/api/llm-configs', auth, async (req, reply) => {
    const input = createLlmConfigInputSchema.parse(req.body);
    const created = await createLlmConfig(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.put('/api/llm-configs/:id/default', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return setDefaultLlmConfig(requireUser(req).id, id);
  });

  app.post('/api/llm-configs/:id/test', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return testLlmConfig(requireUser(req).id, id);
  });

  app.put('/api/llm-configs/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateLlmConfigInputSchema.parse(req.body ?? {});
    return updateLlmConfig(requireUser(req).id, id, input);
  });

  app.delete('/api/llm-configs/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteLlmConfig(requireUser(req).id, id);
    return reply.code(204).send();
  });
}
