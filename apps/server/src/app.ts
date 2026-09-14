import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { authenticate } from './auth/authenticate.js';
import { registerAdminRoutes } from './admin/admin.routes.js';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { registerCardRoutes } from './cards/card.routes.js';
import { registerDocumentRoutes } from './documents/document.routes.js';
import { config } from './config.js';
import { getDb, setDb, type Database } from './db/index.js';
import { registerJobRoutes } from './jobs/jobs.routes.js';
import { registerLlmRoutes } from './llm/llm.routes.js';
import { registerMapRoutes } from './maps/map.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerEvolveRoutes } from './agent/evolve.routes.js';
import { registerWeeklyRoutes } from './agent/weekly.routes.js';
import { registerReviewRoutes } from './review/review.routes.js';
import { registerTopicRoutes } from './topics/topic.routes.js';
import './types.js';

export interface BuildAppOptions {
  db?: Database;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  if (opts.db) setDb(opts.db);

  const app = Fastify({
    logger: true,
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });

  app.decorate('db', getDb());
  app.decorate('authenticate', authenticate);

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(cookie, { secret: config.COOKIE_SECRET });

  registerErrorHandler(app);

  app.get('/health', async () => ({ ok: true as const }));

  registerAuthRoutes(app);
  registerLlmRoutes(app);
  registerDocumentRoutes(app);
  registerCardRoutes(app);
  registerTopicRoutes(app);
  registerMapRoutes(app);
  registerReviewRoutes(app);
  registerEvolveRoutes(app);
  registerWeeklyRoutes(app);
  registerJobRoutes(app);
  registerAdminRoutes(app);

  return app;
}
