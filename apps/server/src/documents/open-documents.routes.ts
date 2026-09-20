import { openCreateDocumentInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { createOpenDocument, getOpenDocument } from './open-documents.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

/** PAT-only open API: markdown/html in, TipTap stored; markdown out for agents. */
export function registerOpenDocumentsRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post(
    '/api/open/documents',
    { ...auth, bodyLimit: 4 * 1024 * 1024 },
    async (req, reply) => {
      // PAT_REQUIRED — cookie/JWT is 403 inside createOpenDocument.
      const input = openCreateDocumentInputSchema.parse(req.body);
      const created = await createOpenDocument(requireUser(req), input);
      return reply.code(201).send(created);
    },
  );

  app.get('/api/open/documents/:id', auth, async (req) => {
    // PAT_REQUIRED — cookie/JWT is 403 inside getOpenDocument.
    const { id } = idParamsSchema.parse(req.params);
    return getOpenDocument(requireUser(req), id);
  });
}
