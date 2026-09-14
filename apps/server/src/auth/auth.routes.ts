import { loginInputSchema, registerInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { getMe, loginUser, registerUser } from './auth.service.js';
import { requireUser } from './authenticate.js';
import { clearAuthCookies } from './cookies.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/auth/register', async (req, reply) => {
    const input = registerInputSchema.parse(req.body);
    const response = await registerUser(input, reply);
    return reply.code(201).send(response);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = loginInputSchema.parse(req.body);
    return loginUser(input, reply);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return getMe(requireUser(req).id);
  });
}
