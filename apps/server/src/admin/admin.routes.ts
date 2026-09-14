import {
  listAdminExecutionsQuerySchema,
  listAdminJobsQuerySchema,
  usageSummaryQuerySchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  getAdminExecution,
  getUsageSummary,
  listAdminExecutions,
  listAdminJobs,
  retryAdminJob,
} from './admin.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerAdminRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/admin/jobs', auth, async (req) => {
    return listAdminJobs(requireUser(req).id, listAdminJobsQuerySchema.parse(req.query));
  });

  app.post('/api/admin/jobs/:id/retry', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return retryAdminJob(requireUser(req).id, id);
  });

  app.get('/api/admin/usage/summary', auth, async (req) => {
    const { days } = usageSummaryQuerySchema.parse(req.query);
    return getUsageSummary(requireUser(req).id, days);
  });

  app.get('/api/admin/executions', auth, async (req) => {
    return listAdminExecutions(requireUser(req).id, listAdminExecutionsQuerySchema.parse(req.query));
  });

  app.get('/api/admin/executions/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getAdminExecution(requireUser(req).id, id);
  });
}
