import {
  createCanvasNodeInputSchema,
  createCanvasNoteInputSchema,
  setCanvasNodeInputSchema,
} from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import { listCanvasRevisions, restoreCanvasRevision } from './canvas-history.js';
import {
  createCanvasNode,
  createPlacedNote,
  deleteCanvasNode,
  listCanvasNodes,
  updateCanvasNode,
} from './canvas.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const nodeParamsSchema = z.object({ id: z.string().uuid(), nodeId: z.string().uuid() });
const revisionParamsSchema = z.object({ id: z.string().uuid(), revisionId: z.string().uuid() });

export function registerCanvasRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  /** 这篇文档画布上已经落库的节点。没摆过的卡片和批注由客户端补成根。 */
  app.get('/api/documents/:id/canvas', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const nodes = await listCanvasNodes(requireUser(req).id, id);
    return { nodes };
  });

  /**
   * 在画布上新建文本或图片节点，可以挂到某个节点下面。
   * @deprecated 仅为旧客户端保留。新的文本/图片节点一律走「note 批注 + 落位」
   * （POST /api/annotations kind='note' → PATCH /api/documents/:id/canvas/:nodeId），
   * 新代码不要再调用这个端点。
   */
  app.post('/api/documents/:id/canvas', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = createCanvasNodeInputSchema.parse(req.body);
    const node = await createCanvasNode(requireUser(req).id, id, input);
    return reply.code(201).send(node);
  });

  /** 在脑图上新建一条想法并落位。文本和图片都走这里，好让回滚能一起撤掉这条想法。 */
  app.post('/api/documents/:id/canvas/notes', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = createCanvasNoteInputSchema.parse(req.body);
    const created = await createPlacedNote(requireUser(req).id, id, input);
    return reply.code(201).send(created);
  });

  /** 这篇文档脑图最近的版本。当前结构与最近一版一致时，那一版标为当前。 */
  app.get('/api/documents/:id/canvas/revisions', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const revisions = await listCanvasRevisions(requireUser(req).id, id);
    return { revisions };
  });

  /** 把脑图结构恢复成这一版，并另记一版，方便再回到恢复前。 */
  app.post('/api/documents/:id/canvas/revisions/:revisionId/restore', auth, async (req) => {
    const { id, revisionId } = revisionParamsSchema.parse(req.params);
    return restoreCanvasRevision(requireUser(req).id, id, revisionId);
  });

  /** 移动节点，或修改文本节点的文字。 */
  app.patch('/api/documents/:id/canvas/:nodeId', auth, async (req) => {
    const { id, nodeId } = nodeParamsSchema.parse(req.params);
    const input = setCanvasNodeInputSchema.parse(req.body);
    return updateCanvasNode(requireUser(req).id, id, nodeId, input);
  });

  /** 删除文本或图片节点。卡片和批注请走各自的删除。 */
  app.delete('/api/documents/:id/canvas/:nodeId', auth, async (req, reply) => {
    const { id, nodeId } = nodeParamsSchema.parse(req.params);
    await deleteCanvasNode(requireUser(req).id, id, nodeId);
    return reply.code(204).send();
  });
}
