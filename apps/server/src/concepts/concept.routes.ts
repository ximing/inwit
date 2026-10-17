import {
  addCardKnowledgeLinkInputSchema,
  createConceptNoteInputSchema,
  documentKnowledgeQuerySchema,
  knowledgeLocationsQuerySchema,
  removeDocumentKnowledgeRefInputSchema,
  setDocumentKnowledgeRefInputSchema,
  updateConceptNoteInputSchema,
  bindExistingConceptPracticeInputSchema,
  commitConceptBatchInputSchema,
  conceptGraphQuerySchema,
  conceptGraphViewInputSchema,
  conceptMatchesQuerySchema,
  conceptVersionInputSchema,
  createConceptBatchInputSchema,
  createConceptInputSchema,
  createConceptPracticeInputSchema,
  createConceptPracticeProposalInputSchema,
  createConceptRelationInputSchema,
  listConceptsQuerySchema,
  refreshConceptPracticeInputSchema,
  resumeConceptPracticeInputSchema,
  saveConceptBundleInputSchema,
  updateConceptDraftInputSchema,
  updateConceptInputSchema,
  updateConceptRelationInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { AppError } from '../errors.js';
import { conceptsReadable, conceptsWritable } from './concepts-flag.js';
import {
  discardConceptBatch,
  getConceptBatch,
  updateConceptDraft,
  createConceptBatch,
} from './concept-batch.service.js';
import { commitConceptBatch } from './concept-commit.js';
import { resolveConceptEvidence } from './concept-evidence.js';
import {
  addCardKnowledgeLink,
  listCardKnowledgeLinks,
  removeCardKnowledgeLink,
} from './card-knowledge.service.js';
import {
  bindExistingConceptPractice,
  createConceptPractice,
  refreshConceptPractice,
  resumeConceptPractice,
  unbindConceptPractice,
} from './concept-practice.service.js';
import {
  createConceptPracticeProposal,
  getConceptPracticeProposal,
} from './concept-proposal.service.js';
import {
  createConceptNote,
  getDocumentKnowledge,
  removeDocumentKnowledgeRef,
  resolveKnowledgeLocations,
  setDocumentKnowledgeRef,
  updateConceptNote,
} from './document-knowledge.service.js';
import {
  archiveConcept,
  archiveConceptRelation,
  createConcept,
  createConceptRelation,
  findConceptMatches,
  getConcept,
  getConceptGraph,
  getConceptRelation,
  listConcepts,
  postConceptGraphView,
  restoreConcept,
  restoreConceptRelation,
  saveConceptBundle,
  updateConcept,
  updateConceptRelation,
} from './concept.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

/**
 * 概念域发布开关（concepts-flag.ts）。
 * CONCEPTS_ENABLED 为主开关；READ/WRITE 未设置时跟随主开关。读关闭时写强制关闭。
 * 读关闭：全部入口 404 CONCEPTS_DISABLED。
 * 只关写：查询仍可用（所有 GET，以及 concept-matches、concept-graph/view），生成与写入 404。
 * 客户端用 GET /health 的 conceptsEnabled（入口与读 API）和 conceptsWritable（新生成与写入）。
 */
function assertConceptsReadable(): void {
  if (!conceptsReadable()) throw AppError.of(404, 'CONCEPTS_DISABLED');
}

function assertConceptsWritable(): void {
  if (!conceptsWritable()) throw AppError.of(404, 'CONCEPTS_DISABLED');
}

export function registerConceptRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  app.get('/api/topics/:id/concepts', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return listConcepts(requireUser(req).id, id, listConceptsQuerySchema.parse(req.query));
  });

  app.post('/api/topics/:id/concepts', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = createConceptInputSchema.parse(req.body);
    return reply.code(201).send(await createConcept(requireUser(req).id, id, input));
  });

  /** 同名/别名匹配建议（POST 以携带别名数组）；只提示，不合并。 */
  app.post('/api/topics/:id/concept-matches', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    const input = conceptMatchesQuerySchema.parse(req.body);
    return { matches: await findConceptMatches(requireUser(req).id, id, input) };
  });

  app.get('/api/topics/:id/concept-graph', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return getConceptGraph(requireUser(req).id, id, conceptGraphQuerySchema.parse(req.query));
  });

  app.post('/api/topics/:id/concept-graph/view', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    const input = conceptGraphViewInputSchema.parse(req.body);
    return postConceptGraphView(requireUser(req).id, id, input);
  });

  app.post('/api/topics/:id/concept-relations', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = createConceptRelationInputSchema.parse(req.body);
    const result = await createConceptRelation(requireUser(req).id, id, input);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.post('/api/topics/:id/concept-bundles', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = saveConceptBundleInputSchema.parse(req.body);
    return reply.code(201).send(await saveConceptBundle(requireUser(req).id, id, input));
  });

  app.get('/api/concepts/:id', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return getConcept(requireUser(req).id, id);
  });

  app.patch('/api/concepts/:id', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = updateConceptInputSchema.parse(req.body);
    return updateConcept(requireUser(req).id, id, input);
  });

  app.post('/api/concepts/:id/archive', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = conceptVersionInputSchema.parse(req.body);
    return archiveConcept(requireUser(req).id, id, input.expectedVersion);
  });

  app.post('/api/concepts/:id/restore', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = conceptVersionInputSchema.parse(req.body);
    return restoreConcept(requireUser(req).id, id, input.expectedVersion);
  });

  app.get('/api/concept-relations/:id', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return getConceptRelation(requireUser(req).id, id);
  });

  app.patch('/api/concept-relations/:id', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = updateConceptRelationInputSchema.parse(req.body);
    return updateConceptRelation(requireUser(req).id, id, input);
  });

  app.post('/api/concept-relations/:id/archive', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = conceptVersionInputSchema.parse(req.body);
    return archiveConceptRelation(requireUser(req).id, id, input.expectedVersion);
  });

  app.post('/api/concept-relations/:id/restore', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = conceptVersionInputSchema.parse(req.body);
    return restoreConceptRelation(requireUser(req).id, id, input.expectedVersion);
  });

  /**
   * 文章生成入口（M2/T5）：创建批次并入队 concept_extract。
   * 发布开关关闭时 404；同 requestId 重放返回原结果。
   */
  app.post('/api/documents/:id/concept-batches', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = createConceptBatchInputSchema.parse(req.body);
    return createConceptBatch(requireUser(req).id, id, input);
  });

  app.get('/api/concept-batches/:id', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return getConceptBatch(requireUser(req).id, id);
  });

  app.patch('/api/concept-batches/:id', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = updateConceptDraftInputSchema.parse(req.body);
    return updateConceptDraft(requireUser(req).id, id, input);
  });

  app.post('/api/concept-batches/:id/commit', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = commitConceptBatchInputSchema.parse(req.body);
    return commitConceptBatch(requireUser(req).id, id, input);
  });

  app.post('/api/concept-batches/:id/discard', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    return discardConceptBatch(requireUser(req).id, id);
  });

  app.get('/api/concept-evidence/:id/resolve', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return resolveConceptEvidence(requireUser(req).id, id);
  });

  // ---- M3/T6：练习绑定、出题建议、卡片导航关联 ----

  app.post('/api/concept-practices', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const input = createConceptPracticeInputSchema.parse(req.body);
    const result = await createConceptPractice(requireUser(req).id, input);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.post('/api/concept-practices/bind-existing', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const input = bindExistingConceptPracticeInputSchema.parse(req.body);
    const result = await bindExistingConceptPractice(requireUser(req).id, input);
    return reply.code(201).send(result);
  });

  app.post('/api/concept-practices/:id/refresh', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = refreshConceptPracticeInputSchema.parse(req.body);
    return refreshConceptPractice(requireUser(req).id, id, input);
  });

  app.post('/api/concept-practices/:id/resume', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = resumeConceptPracticeInputSchema.parse(req.body);
    return resumeConceptPractice(requireUser(req).id, id, input);
  });

  app.delete('/api/concept-practices/:id', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    return unbindConceptPractice(requireUser(req).id, id);
  });

  app.post('/api/concept-practice-proposals', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const input = createConceptPracticeProposalInputSchema.parse(req.body);
    const result = await createConceptPracticeProposal(requireUser(req).id, input);
    return reply.code(202).send(result);
  });

  app.get('/api/concept-practice-proposals/:id', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return getConceptPracticeProposal(requireUser(req).id, id);
  });

  app.get('/api/cards/:id/knowledge-links', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return { items: await listCardKnowledgeLinks(requireUser(req).id, id) };
  });

  app.post('/api/cards/:id/knowledge-links', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = addCardKnowledgeLinkInputSchema.parse(req.body);
    const result = await addCardKnowledgeLink(requireUser(req).id, id, input);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.delete('/api/cards/:id/knowledge-links/:linkId', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id, linkId } = z
      .object({ id: z.string().uuid(), linkId: z.string().uuid() })
      .parse(req.params);
    await removeCardKnowledgeLink(requireUser(req).id, id, linkId);
    return reply.code(204).send();
  });

  // ---- T7a：本文知识范围、说明与位置解析 ----

  app.get('/api/documents/:id/knowledge', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    return getDocumentKnowledge(
      requireUser(req).id,
      id,
      documentKnowledgeQuerySchema.parse(req.query),
    );
  });

  app.post('/api/documents/:id/knowledge-refs', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = setDocumentKnowledgeRefInputSchema.parse(req.body);
    const result = await setDocumentKnowledgeRef(requireUser(req).id, id, input);
    return reply.code(201).send(result);
  });

  app.delete('/api/documents/:id/knowledge-refs/:refId', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id, refId } = z
      .object({ id: z.string().uuid(), refId: z.string().uuid() })
      .parse(req.params);
    const input = removeDocumentKnowledgeRefInputSchema.parse(req.body ?? {});
    return removeDocumentKnowledgeRef(requireUser(req).id, id, refId, input);
  });

  app.get('/api/documents/:id/knowledge-locations', auth, async (req) => {
    assertConceptsReadable();
    const { id } = idParamsSchema.parse(req.params);
    const query = knowledgeLocationsQuerySchema.parse(req.query);
    return resolveKnowledgeLocations(requireUser(req).id, id, query);
  });

  app.post('/api/concept-notes', auth, async (req, reply) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const input = createConceptNoteInputSchema.parse(req.body);
    return reply.code(201).send(await createConceptNote(requireUser(req).id, input));
  });

  app.patch('/api/concept-notes/:id', auth, async (req) => {
    assertConceptsReadable();
    assertConceptsWritable();
    const { id } = idParamsSchema.parse(req.params);
    const input = updateConceptNoteInputSchema.parse(req.body);
    return updateConceptNote(requireUser(req).id, id, input);
  });
}
