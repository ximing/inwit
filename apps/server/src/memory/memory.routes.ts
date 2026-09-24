import { paginationQuerySchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { listMemoryCollections, listMemoryRevisions } from './memory.service.js';

export function registerMemoryRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/memory/collections', auth, async (req) => {
    return listMemoryCollections(requireUser(req).id);
  });

  app.get('/api/memory/revisions', auth, async (req) => {
    const query = paginationQuerySchema.parse(req.query ?? {});
    return listMemoryRevisions(requireUser(req).id, query);
  });
}
