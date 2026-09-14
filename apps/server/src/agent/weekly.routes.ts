import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { enqueueWeeklyReport, getLatestWeeklyReport } from './weekly-enqueue.js';

export function registerWeeklyRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post('/api/reports/weekly/generate', auth, async (req, reply) => {
    const { job, created } = await enqueueWeeklyReport(requireUser(req).id);
    return reply.code(created ? 201 : 200).send(job);
  });

  app.get('/api/reports/latest', auth, async (req) => {
    const report = await getLatestWeeklyReport(requireUser(req).id);
    return { report };
  });
}
