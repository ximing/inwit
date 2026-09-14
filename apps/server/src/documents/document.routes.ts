import {
  createChatInputSchema,
  createDocumentInputSchema,
  listDocumentsQuerySchema,
  updateDocumentInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  createChat,
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from './document.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerDocumentRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/documents', auth, async (req) => {
    return listDocuments(requireUser(req).id, listDocumentsQuerySchema.parse(req.query));
  });

  app.post('/api/documents', auth, async (req, reply) => {
    const input = createDocumentInputSchema.parse(req.body);
    const created = await createDocument(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.post('/api/chat', auth, async (req, reply) => {
    const input = createChatInputSchema.parse(req.body);
    const created = await createChat(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.get('/api/documents/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getDocument(requireUser(req).id, id);
  });

  app.put('/api/documents/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateDocumentInputSchema.parse(req.body);
    return updateDocument(requireUser(req).id, id, input);
  });

  app.delete('/api/documents/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteDocument(requireUser(req).id, id);
    return reply.code(204).send();
  });
}
