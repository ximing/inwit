import { searchQuerySchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { search } from './search.service.js';

export function registerSearchRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/search', auth, async (req) => {
    const query = searchQuerySchema.parse(req.query);
    return search(requireUser(req).id, query);
  });
}
