import { loginInputSchema, refreshInputSchema, registerInputSchema } from '@inwit/dto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { authModeFromOrigin } from './auth-logic.js';
import { getMe, loginUser, refreshBearer, registerUser } from './auth.service.js';
import { requireUser } from './authenticate.js';
import { clearAuthCookies } from './cookies.js';

function modeOf(req: FastifyRequest) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  return authModeFromOrigin(origin, config.WEB_ORIGIN);
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', async (req, reply) => {
    const input = registerInputSchema.parse(req.body);
    const response = await registerUser(input, reply, modeOf(req));
    return reply.code(201).send(response);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = loginInputSchema.parse(req.body);
    return loginUser(input, reply, modeOf(req));
  });

  app.post('/api/auth/refresh', async (req) => {
    const input = refreshInputSchema.parse(req.body);
    return refreshBearer(input.refreshToken);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return getMe(requireUser(req).id);
  });
}
