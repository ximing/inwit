import { updateAnnotation } from '../annotations/annotation.service.js';
import { updateCanvasNode } from '../canvas/canvas.service.js';
import { updateCard } from '../cards/card.service.js';
import { mindNodeKey, mindNodeLabel } from '../conversations/conversation-message-logic.js';
import { loadMindNodeFacts, ownedNodeRefs } from '../conversations/conversation-nodes.js';
import { AppError } from '../errors.js';
import type { MindNodeUpdatePlan } from './conversation-logic.js';

export { loadMindNodeFacts, ownedNodeRefs };

function reasonOf(err: unknown): string {
  if (err instanceof AppError && err.message.trim()) return err.message.trim();
  return '没能写入';
}

export async function applyMindNodeUpdate(
  userId: string,
  ref: { documentId: string; nodeId: string },
  plan: Extract<MindNodeUpdatePlan, { ok: true }>,
): Promise<{ ok: true; label: string } | { ok: false; reason: string }> {
  const [facts] = await loadMindNodeFacts(userId, [
    {
      documentId: ref.documentId,
      nodeId: ref.nodeId,
      kind: plan.kind,
      label: '节点',
    },
  ]);
  if (!facts || facts.missing) return { ok: false, reason: '找不到这个节点' };
  if (facts.kind !== plan.kind) return { ok: false, reason: '节点类型对不上' };
  if (facts.rejected) return { ok: false, reason: '这张卡已经丢弃，不能修改' };
  try {
    if (plan.kind === 'card') {
      await updateCard(userId, ref.nodeId, {
        concept: plan.concept,
        ...(plan.example !== undefined ? { example: plan.example } : {}),
      });
      return { ok: true, label: mindNodeLabel(plan.concept, '卡片') };
    }
    if (plan.kind === 'annotation') {
      await updateAnnotation(userId, ref.nodeId, { note: plan.note });
      return { ok: true, label: mindNodeLabel(plan.note, facts.label) };
    }
    await updateCanvasNode(userId, ref.documentId, ref.nodeId, { text: plan.text });
    return { ok: true, label: mindNodeLabel(plan.text, '文本') };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}

export function mindNodeAllowed(
  keys: ReadonlySet<string>,
  documentId: string,
  nodeId: string,
): boolean {
  return keys.has(mindNodeKey(documentId, nodeId));
}
