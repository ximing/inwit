import { submitReviewFeedbackSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { getReviewStats, getReviewToday, submitReviewFeedback } from './review.service.js';

const cardIdParamsSchema = z.object({ cardId: z.string().uuid() });

export function registerReviewRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/review/today', auth, async (req) => {
    return getReviewToday(requireUser(req).id);
  });

  app.get('/api/review/stats', auth, async (req) => {
    return getReviewStats(requireUser(req).id);
  });

  app.post('/api/review/:cardId/feedback', auth, async (req) => {
    const { cardId } = cardIdParamsSchema.parse(req.params);
    const input = submitReviewFeedbackSchema.parse(req.body);
    return submitReviewFeedback(requireUser(req).id, cardId, input.feedback);
  });
}
