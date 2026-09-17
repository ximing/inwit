import { reviewSettingsSchema, submitReviewFeedbackSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  getReviewSettings,
  getReviewStats,
  getReviewToday,
  getStrugglingCards,
  getReviewTopicStats,
  submitReviewFeedback,
  updateReviewSettings,
} from './review.service.js';

const cardIdParamsSchema = z.object({ cardId: z.string().uuid() });
const strugglingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export function registerReviewRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/review/today', auth, async (req) => {
    return getReviewToday(requireUser(req).id);
  });

  app.get('/api/review/stats', auth, async (req) => {
    return getReviewStats(requireUser(req).id);
  });

  app.get('/api/review/stats/topics', auth, async (req) => {
    return getReviewTopicStats(requireUser(req).id);
  });

  app.get('/api/review/struggling', auth, async (req) => {
    const { limit } = strugglingQuerySchema.parse(req.query);
    return getStrugglingCards(requireUser(req).id, limit ?? 5);
  });

  app.get('/api/review/settings', auth, async (req) => {
    return getReviewSettings(requireUser(req).id);
  });

  app.put('/api/review/settings', auth, async (req) => {
    const input = reviewSettingsSchema.parse(req.body);
    return updateReviewSettings(requireUser(req).id, input);
  });

  app.post('/api/review/:cardId/feedback', auth, async (req) => {
    const { cardId } = cardIdParamsSchema.parse(req.params);
    const input = submitReviewFeedbackSchema.parse(req.body);
    return submitReviewFeedback(requireUser(req).id, cardId, input.feedback);
  });
}
