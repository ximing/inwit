import type { ConversationNodeRef } from '@inwit/dto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { updateAnnotation } from '../annotations/annotation.service.js';
import { updateCanvasNode } from '../canvas/canvas.service.js';
import { updateCard } from '../cards/card.service.js';
import { getDb } from '../db/index.js';
import { annotations, cardQuestions, cards, canvasNodes } from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  emptyMindNodeFacts,
  mindNodeKey,
  mindNodeLabel,
  planMindNodeUpdate,
  type MindNodeFacts,
  type MindNodeUpdatePlan,
} from './conversation-logic.js';

function reasonOf(err: unknown): string {
  if (err instanceof AppError && err.message.trim()) return err.message.trim();
  return '没能写入';
}

/**
 * Load the nodes the user attached. Missing rows stay in order so the prompt
 * can say the node is gone. Kind and label come from the live row.
 */
export async function loadMindNodeFacts(
  userId: string,
  refs: readonly ConversationNodeRef[],
): Promise<MindNodeFacts[]> {
  if (refs.length === 0) return [];
  const ids = [...new Set(refs.map((ref) => ref.nodeId))];
  const db = getDb();
  const [cardRows, noteRows, canvasRows] = await Promise.all([
    db
      .select({
        id: cards.id,
        documentId: cards.documentId,
        concept: cards.concept,
        example: cards.example,
        confusionPoint: cards.confusionPoint,
        acceptance: cards.acceptance,
      })
      .from(cards)
      .where(and(eq(cards.userId, userId), inArray(cards.id, ids), isNull(cards.deletedAt))),
    db
      .select({
        id: annotations.id,
        documentId: annotations.documentId,
        quote: annotations.quote,
        note: annotations.note,
      })
      .from(annotations)
      .where(
        and(eq(annotations.userId, userId), inArray(annotations.id, ids), isNull(annotations.deletedAt)),
      ),
    db
      .select({
        id: canvasNodes.id,
        documentId: canvasNodes.documentId,
        kind: canvasNodes.kind,
        text: canvasNodes.text,
      })
      .from(canvasNodes)
      .where(and(eq(canvasNodes.userId, userId), inArray(canvasNodes.id, ids))),
  ]);
  const cardIds = cardRows.map((row) => row.id);
  const questionRows =
    cardIds.length === 0
      ? []
      : await db
          .select({
            cardId: cardQuestions.cardId,
            question: cardQuestions.question,
            answer: cardQuestions.answer,
          })
          .from(cardQuestions)
          .where(inArray(cardQuestions.cardId, cardIds))
          .orderBy(asc(cardQuestions.createdAt), asc(cardQuestions.id));
  const questionsByCard = new Map<string, { question: string; answer: string }[]>();
  for (const row of questionRows) {
    const list = questionsByCard.get(row.cardId) ?? [];
    list.push({ question: row.question, answer: row.answer });
    questionsByCard.set(row.cardId, list);
  }

  return refs.map((ref) => {
    const card = cardRows.find((row) => row.id === ref.nodeId && row.documentId === ref.documentId);
    if (card) {
      return {
        ...emptyMindNodeFacts(ref, false),
        kind: 'card' as const,
        label: mindNodeLabel(card.concept, '卡片'),
        rejected: card.acceptance === 'rejected',
        concept: card.concept,
        example: card.example,
        confusionPoint: card.confusionPoint,
        questions: questionsByCard.get(card.id) ?? [],
      };
    }
    const note = noteRows.find((row) => row.id === ref.nodeId && row.documentId === ref.documentId);
    if (note) {
      return {
        ...emptyMindNodeFacts(ref, false),
        kind: 'annotation' as const,
        label: mindNodeLabel(note.note.trim() || note.quote, '批注'),
        quote: note.quote,
        note: note.note,
      };
    }
    const canvas = canvasRows.find(
      (row) =>
        row.id === ref.nodeId &&
        row.documentId === ref.documentId &&
        (row.kind === 'text' || row.kind === 'image'),
    );
    if (!canvas) return emptyMindNodeFacts(ref, true);
    if (canvas.kind === 'image') {
      return {
        ...emptyMindNodeFacts(ref, false),
        kind: 'image' as const,
        label: '图片',
      };
    }
    return {
      ...emptyMindNodeFacts(ref, false),
      kind: 'text' as const,
      label: mindNodeLabel(canvas.text ?? '', '文本'),
      text: canvas.text ?? '',
    };
  });
}

export function ownedNodeRefs(facts: readonly MindNodeFacts[]): ConversationNodeRef[] {
  return facts
    .filter((node) => !node.missing)
    .map((node) => ({
      documentId: node.documentId,
      nodeId: node.nodeId,
      kind: node.kind,
      label: node.label,
    }));
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
