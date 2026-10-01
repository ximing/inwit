import { createCanvasNodeInputSchema, setCanvasNodeInputSchema } from '@inwit/dto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/authenticate.js';
import {
  createCanvasNode,
  deleteCanvasNode,
  listCanvasNodes,
  updateCanvasNode,
} from './canvas.service.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const nodeParamsSchema = z.object({ id: z.string().uuid(), nodeId: z.string().uuid() });

export function registerCanvasRoutes(app: FastifyInstance): void {
  const auth = { preHandler: [app.authenticate] };

  /** 这篇文档画布上已经落库的节点。没摆过的卡片和批注由客户端补成根。 */
  app.get('/api/documents/:id/canvas', auth, async (req) => {
    const { id } = idParamsSchema.parse(req.params);
    const nodes = await listCanvasNodes(requireUser(req).id, id);
    return { nodes };
  });

  /** 在画布上新建文本或图片节点，可以挂到某个节点下面。 */
  app.post('/api/documents/:id/canvas', auth, async (req, reply) => {
    const { id } = idParamsSchema.parse(req.params);
    const input = createCanvasNodeInputSchema.parse(req.body);
    const node = await createCanvasNode(requireUser(req).id, id, input);
    return reply.code(201).send(node);
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
