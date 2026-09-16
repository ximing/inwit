import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from './db/index.js';

export type AuthPrincipal = { id: string; accessTokenId?: string };

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AuthPrincipal;
  }
}
