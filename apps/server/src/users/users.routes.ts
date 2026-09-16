import {
  avatarUploadUrlInputSchema,
  confirmAvatarInputSchema,
  createAccessTokenInputSchema,
  listAccessTokenLogsQuerySchema,
  updateProfileInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  createAccessToken,
  listAccessTokenLogs,
  listAccessTokens,
  revealAccessToken,
} from '../auth/access-tokens.js';
import { confirmAvatar, requestAvatarUpload, updateProfile } from './users.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export function registerUserRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.patch('/api/me', auth, async (req) => {
    const input = updateProfileInputSchema.parse(req.body ?? {});
    return updateProfile(requireUser(req).id, input);
  });

  app.get('/api/me/access-tokens', auth, async (req) => {
    return listAccessTokens(requireUser(req).id);
  });

  app.post('/api/me/access-tokens', auth, async (req, reply) => {
    const input = createAccessTokenInputSchema.parse(req.body ?? {});
    const created = await createAccessToken(requireUser(req).id, input);
    return reply.code(201).send(created);
  });

  app.post('/api/me/access-tokens/:id/reveal', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    return revealAccessToken(requireUser(req).id, id);
  });

  app.get('/api/me/access-token-logs', auth, async (req) => {
    return listAccessTokenLogs(
      requireUser(req).id,
      listAccessTokenLogsQuerySchema.parse(req.query),
    );
  });

  app.post('/api/me/avatar/upload-url', auth, async (req) => {
    const input = avatarUploadUrlInputSchema.parse(req.body);
    return requestAvatarUpload(requireUser(req).id, input);
  });

  app.post('/api/me/avatar', auth, async (req) => {
    const input = confirmAvatarInputSchema.parse(req.body);
    return confirmAvatar(requireUser(req).id, input);
  });
}
