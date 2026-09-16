import { listJobsQuerySchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { cancelJob, getJob, getJobQueue, getJobUsage, listJobs, retryJob } from './jobs.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerJobRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/jobs', auth, async (req) => {
    return listJobs(requireUser(req).id, listJobsQuerySchema.parse(req.query));
  });

  app.get('/api/jobs/queue', auth, async (req) => {
    return getJobQueue(requireUser(req).id);
  });

  app.get('/api/jobs/usage', auth, async (req) => {
    return getJobUsage(requireUser(req).id);
  });

  app.get('/api/jobs/:id', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return getJob(requireUser(req).id, id);
  });

  app.post('/api/jobs/:id/retry', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return retryJob(requireUser(req).id, id);
  });

  app.post('/api/jobs/:id/cancel', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return cancelJob(requireUser(req).id, id);
  });
}
