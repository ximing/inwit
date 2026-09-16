import { upsertOcrConfigInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { getOcrConfig, testOcrConfig, upsertOcrConfig } from './ocr.service.js';

export function registerOcrRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/ocr-config', auth, async (req) => {
    return getOcrConfig(requireUser(req).id);
  });

  app.put('/api/ocr-config', auth, async (req) => {
    const input = upsertOcrConfigInputSchema.parse(req.body ?? {});
    return upsertOcrConfig(requireUser(req).id, input);
  });

  app.post('/api/ocr-config/test', auth, async (req) => {
    return testOcrConfig(requireUser(req).id);
  });
}
