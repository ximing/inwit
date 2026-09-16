import {
  createAnnotationInputSchema,
  updateAnnotationInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  createAnnotation,
  deleteAnnotation,
  getAnnotationImage,
  listDocumentAnnotations,
  updateAnnotation,
} from './annotation.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerAnnotationRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/documents/:id/annotations', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return listDocumentAnnotations(requireUser(req).id, id);
  });

  app.post('/api/annotations', auth, async (req, reply) => {
    const input = createAnnotationInputSchema.parse(req.body);
    const created = await createAnnotation(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.patch('/api/annotations/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = updateAnnotationInputSchema.parse(req.body);
    return updateAnnotation(requireUser(req).id, id, input);
  });

  app.delete('/api/annotations/:id', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    await deleteAnnotation(requireUser(req).id, id);
    return reply.code(204).send();
  });

  app.get('/api/annotations/:id/image', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getAnnotationImage(requireUser(req).id, id);
  });
}
