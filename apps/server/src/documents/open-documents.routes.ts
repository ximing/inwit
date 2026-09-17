import { openCreateDocumentInputSchema, type CreateDocumentInput } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/authenticate.js';
import { AppError } from '../errors.js';
import { createDocument } from './document.service.js';
import { markdownToContentJson } from './content-json.js';
import { buildFinalMarkdown, checkOpenTokenRate, htmlToMarkdownViaTurndown } from './open-documents-logic.js';

/** PAT-only open API: create a document from raw html/markdown (used by vital's 转存). */
export function registerOpenDocumentsRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.post(
    '/api/open/documents',
    { ...auth, bodyLimit: 4 * 1024 * 1024 },
    async (req, reply) => {
      const user = requireUser(req);
      if (user.accessTokenId === undefined) throw AppError.of(403, 'PAT_REQUIRED');
      checkOpenTokenRate(user.accessTokenId);

      const input = openCreateDocumentInputSchema.parse(req.body);
      const markdown = input.markdown ?? htmlToMarkdownViaTurndown(input.html!);
      const finalMarkdown = buildFinalMarkdown(markdown, input.sourceUrl);
      const created = await createDocument(user.id, {
        title: input.title,
        contentJson: markdownToContentJson(finalMarkdown) as CreateDocumentInput['contentJson'],
        topicId: input.topicId,
        source: 'api',
      });
      return reply.code(201).send(created);
    },
  );
}
