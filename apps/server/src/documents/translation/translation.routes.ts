import { registerTranslationStream } from './translation-stream.js';
import {
  pdfSegmentsQuerySchema,
  selectionTranslationRequestSchema,
  translationDocumentParamsSchema,
  translationJobParamsSchema,
  translationRegenerateSchema,
  translationRequestSchema,
  translationResultParamsSchema,
  translationRetrySchema,
  translationsQuerySchema,
} from "@inwit/dto";
import type { FastifyInstance } from "fastify";
import { requireUser } from "../../auth/authenticate.js";
import { getPdfSegments } from "./index.service.js";
import {
  getTranslationJob,
  readTranslations,
  regenerateTranslation,
  requestSegmentTranslation,
  requestSelectionTranslation,
  retryTranslation,
} from "./translation.service.js";
export function registerPdfTranslationRoutes(app: FastifyInstance) {
  registerTranslationStream(app);
  const auth = { preHandler: [app.authenticate] };
  app.get("/api/documents/:id/pdf-segments", auth, async (req) => {
    const { id } = translationDocumentParamsSchema.parse(req.params);
    return getPdfSegments(
      requireUser(req).id,
      id,
      pdfSegmentsQuerySchema.parse(req.query).pageIndex,
    );
  });
  app.get("/api/documents/:id/translations", auth, async (req) => {
    const { id } = translationDocumentParamsSchema.parse(req.params),
      q = translationsQuerySchema.parse(req.query);
    return readTranslations(
      requireUser(req).id,
      id,
      q.segmentIds,
      q.fileRevision,
    );
  });
  app.post("/api/documents/:id/translations", auth, async (req, reply) => {
    const { id } = translationDocumentParamsSchema.parse(req.params);
    const result = await requestSegmentTranslation(
      requireUser(req).id,
      id,
      translationRequestSchema.parse(req.body),
    );
    return reply
      .code(
        result.job &&
          ["queued", "preparing", "dispatched"].includes(result.job.state)
          ? 202
          : 200,
      )
      .send(result);
  });
  app.post(
    "/api/documents/:id/translations/selection",
    auth,
    async (req, reply) => {
      const { id } = translationDocumentParamsSchema.parse(req.params);
      const result = await requestSelectionTranslation(
        requireUser(req).id,
        id,
        selectionTranslationRequestSchema.parse(req.body),
      );
      return reply
        .code(
          result.job &&
            ["queued", "preparing", "dispatched"].includes(result.job.state)
            ? 202
            : 200,
        )
        .send(result);
    },
  );
  app.get("/api/documents/:id/translation-jobs/:jobId", auth, async (req) => {
    const { id, jobId } = translationJobParamsSchema.parse(req.params);
    return getTranslationJob(requireUser(req).id, id, jobId);
  });
  app.post(
    "/api/documents/:id/translation-jobs/:jobId/retry",
    auth,
    async (req, reply) => {
      const { id, jobId } = translationJobParamsSchema.parse(req.params);
      return reply
        .code(202)
        .send(
          await retryTranslation(
            requireUser(req).id,
            id,
            jobId,
            translationRetrySchema.parse(req.body),
          ),
        );
    },
  );
  app.post(
    "/api/documents/:id/translations/:translationId/regenerate",
    auth,
    async (req, reply) => {
      const { id, translationId } = translationResultParamsSchema.parse(
        req.params,
      );
      return reply
        .code(202)
        .send(
          await regenerateTranslation(
            requireUser(req).id,
            id,
            translationId,
            translationRegenerateSchema.parse(req.body).idempotencyKey,
          ),
        );
    },
  );
}
