import {
  createChatInputSchema,
  createDocumentInputSchema,
  createSelectionCardsInputSchema,
  excerptUploadInputSchema,
  importAbortInputSchema,
  importCompleteInputSchema,
  importInitInputSchema,
  importPartsInputSchema,
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
  enqueueSelectionCards,
  getDocument,
  getDocumentFile,
  listDocuments,
  requestExcerptUpload,
  retryDocument,
  updateDocument,
} from './document.service.js';
import { abortImport, completeImport, initImport, presignImportParts } from './import.service.js';

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

  app.post('/api/documents/import/init', auth, async (req, reply) => {
    const input = importInitInputSchema.parse(req.body);
    const created = await initImport(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.post('/api/documents/import/:id/parts', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = importPartsInputSchema.parse(req.body);
    return presignImportParts(requireUser(req).id, id, input);
  });

  app.post('/api/documents/import/:id/complete', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = importCompleteInputSchema.parse(req.body);
    return completeImport(requireUser(req).id, id, input);
  });

  app.post('/api/documents/import/:id/abort', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = importAbortInputSchema.parse(req.body);
    await abortImport(requireUser(req).id, id, input);
    return reply.code(204).send();
  });

  app.post('/api/chat', auth, async (req, reply) => {
    const input = createChatInputSchema.parse(req.body);
    const created = await createChat(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.post('/api/documents/:id/selection-cards', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = createSelectionCardsInputSchema.parse(req.body);
    const job = await enqueueSelectionCards(requireUser(req).id, id, input);
    return reply.code(201).send(job);
  });

  app.post('/api/documents/:id/retry', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const job = await retryDocument(requireUser(req).id, id);
    return reply.code(201).send(job);
  });

  app.get('/api/documents/:id/file', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getDocumentFile(requireUser(req).id, id);
  });

  app.post('/api/documents/:id/excerpts', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = excerptUploadInputSchema.parse(req.body);
    return requestExcerptUpload(requireUser(req).id, id, input);
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
