import {
  archiveListQuerySchema,
  createChatInputSchema,
  createDocumentInputSchema,
  createSelectionCardsInputSchema,
  excerptUploadInputSchema,
  importAbortInputSchema,
  importCompleteInputSchema,
  importInitInputSchema,
  importPartsInputSchema,
  listDocumentsQuerySchema,
  screenshotInitInputSchema,
  updateDocumentInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  archiveDocument,
  createChat,
  createDocument,
  destroyDocument,
  enqueueSelectionCards,
  getDocument,
  getDocumentFile,
  listArchivedDocuments,
  listDocuments,
  requestExcerptUpload,
  restoreDocument,
  retryDocument,
  updateDocument,
} from './document.service.js';
import { abortImport, completeImport, initImport, presignImportParts } from './import.service.js';
import { completeScreenshot, initScreenshot } from './screenshot.service.js';

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

  app.post('/api/documents/screenshot/init', auth, async (req, reply) => {
    const input = screenshotInitInputSchema.parse(req.body);
    const created = await initScreenshot(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.post('/api/documents/screenshot/:id/complete', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return completeScreenshot(requireUser(req).id, id);
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

  app.get('/api/documents/archived', auth, async (req) => {
    const query = archiveListQuerySchema.parse(req.query ?? {});
    return listArchivedDocuments(requireUser(req).id, query);
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

  /** Soft delete: the document (with its annotations) moves to 回收站. */
  app.delete('/api/documents/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await archiveDocument(requireUser(req).id, id);
    return reply.code(204).send();
  });

  app.post('/api/documents/:id/restore', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return restoreDocument(requireUser(req).id, id);
  });

  /** Permanent delete from 回收站; S3 objects are cleaned best-effort. */
  app.delete('/api/documents/:id/permanent', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await destroyDocument(requireUser(req).id, id);
    return reply.code(204).send();
  });
}
