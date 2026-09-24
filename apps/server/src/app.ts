import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { authenticate } from './auth/authenticate.js';
import { registerAccessTokenLogHook } from './auth/access-tokens.js';
import { registerAdminRoutes } from './admin/admin.routes.js';
import { registerAnnotationRoutes } from './annotations/annotation.routes.js';
import { registerAssetRoutes } from './assets/asset.routes.js';
import { registerAuthRoutes } from './auth/auth.routes.js';
import { registerCardRoutes } from './cards/card.routes.js';
import { registerDocumentRoutes } from './documents/document.routes.js';
import { registerOpenDocumentsRoutes } from './documents/open-documents.routes.js';
import { config } from './config.js';
import { getDb, setDb, type Database } from './db/index.js';
import { registerJobRoutes } from './jobs/jobs.routes.js';
import { registerLlmRoutes } from './llm/llm.routes.js';
import { registerOcrRoutes } from './ocr/ocr.routes.js';
import { registerMapRoutes } from './maps/map.routes.js';
import { registerMemoryRoutes } from './memory/memory.routes.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerWebStatic } from './web-static.js';
import { registerEvolveRoutes } from './agent/evolve.routes.js';
import { registerWeeklyRoutes } from './agent/weekly.routes.js';
import { registerReviewRoutes } from './review/review.routes.js';
import { registerSearchRoutes } from './search/search.routes.js';
import { registerTopicRoutes } from './topics/topic.routes.js';
import { registerUserRoutes } from './users/users.routes.js';
import './types.js';

export interface BuildAppOptions {
  db?: Database;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  if (opts.db) setDb(opts.db);

  const app = Fastify({
    logger: true,
    requestIdHeader: 'x-request-id',
  });

  app.decorate('db', getDb());
  app.decorate('authenticate', authenticate);
  registerAccessTokenLogHook(app);

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(cookie, { secret: config.COOKIE_SECRET });
  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
      fields: 8,
      parts: 10,
    },
    throwFileSizeLimit: true,
  });

  registerErrorHandler(app);

  app.get('/health', async () => ({ ok: true as const }));

  registerAuthRoutes(app);
  registerUserRoutes(app);
  registerLlmRoutes(app);
  registerOcrRoutes(app);
  registerDocumentRoutes(app);
  registerOpenDocumentsRoutes(app);
  registerAssetRoutes(app);
  registerSearchRoutes(app);
  registerAnnotationRoutes(app);
  registerCardRoutes(app);
  registerMemoryRoutes(app);
  registerTopicRoutes(app);
  registerMapRoutes(app);
  registerReviewRoutes(app);
  registerEvolveRoutes(app);
  registerWeeklyRoutes(app);
  registerJobRoutes(app);
  registerAdminRoutes(app);

  await registerWebStatic(app);

  return app;
}
