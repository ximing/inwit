import { syncPollQuerySchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { pollSync } from './sync.service.js';

export function registerSyncRoutes(app: FastifyInstance): void {
  app.get('/api/sync', { preHandler: [app.authenticate] }, async (req) => {
    return pollSync(requireUser(req).id, syncPollQuerySchema.parse(req.query));
  });
}
