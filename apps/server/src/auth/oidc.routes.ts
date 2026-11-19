import { oidcReturnQuerySchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from './authenticate.js';
import {
  beginOidc,
  clearOidcCookie,
  completeOidc,
  oidcAccount,
  oidcFailureLocation,
  oidcStatus,
} from './oidc.service.js';

function returnQuery(query: unknown): string | undefined {
  const parsed = oidcReturnQuerySchema.safeParse(query);
  return parsed.success ? parsed.data.return : undefined;
}

export function registerOidcRoutes(app: FastifyInstance): void {
  app.get('/api/auth/oidc/status', async () => oidcStatus());

  app.get('/api/auth/oidc/start', async (req, reply) => {
    try {
      return reply.redirect(await beginOidc(req, reply, 'login', returnQuery(req.query)));
    } catch {
      clearOidcCookie(reply);
      return reply.redirect(oidcFailureLocation('login', 'OIDC_UNAVAILABLE'));
    }
  });

  app.get('/api/auth/oidc/callback', async (req, reply) => {
    try {
      return reply.redirect(await completeOidc(req, reply));
    } catch {
      clearOidcCookie(reply);
      return reply.redirect(oidcFailureLocation('login', 'OIDC_UNAVAILABLE'));
    }
  });

  app.get('/api/auth/oidc/bind/start', async (req, reply) => {
    try {
      return reply.redirect(await beginOidc(req, reply, 'bind', returnQuery(req.query)));
    } catch {
      clearOidcCookie(reply);
      return reply.redirect(oidcFailureLocation('bind', 'OIDC_UNAVAILABLE'));
    }
  });

  app.get('/api/me/oidc', { preHandler: [app.authenticate] }, async (req) => {
    return oidcAccount(requireUser(req).id);
  });
}
