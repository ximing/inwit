import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { enqueueAnalyzePatterns } from './analyze-enqueue.js';

export function registerEvolveRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post('/api/evolve/analyze', auth, async (req, reply) => {
    const { job, created } = await enqueueAnalyzePatterns(requireUser(req).id);
    return reply.code(created ? 201 : 200).send(job);
  });
}
