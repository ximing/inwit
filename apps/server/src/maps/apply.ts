import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { cards, documents, mapNodes } from '../db/schema.js';
import { AppError } from '../errors.js';
import { recalculateMapNodeStatus } from './map.service.js';
import {
  collectOutlineAttachments,
  droppedAttachments,
  flattenOutline,
  OutlineError,
  type OutlineNodeInput,
} from './outline.js';
import { loadTopicMapSnapshot } from './snapshot.js';

export interface ApplyOutlineResult {
  nodeCount: number;
  created: number;
  reused: number;
  deleted: number;
  movedCards: number;
  movedDocuments: number;
  blankNodes: number;
}

function rethrowOutline(err: unknown): never {
  if (err instanceof OutlineError) throw AppError.of(400, 'MAP_ORGANIZE_INVALID', err.message);
  throw err;
}

export async function applyTopicOutline(opts: {
  userId: string;
  topicId: string;
  roots: OutlineNodeInput[];
}): Promise<ApplyOutlineResult> {
  let flat;
  try {
    flat = flattenOutline(opts.roots);
  } catch (err) {
    rethrowOutline(err);
  }

  const db = getDb();
  const loaded = await loadTopicMapSnapshot(opts.topicId, db);
  const existingById = new Map(loaded.nodes.map((row) => [row.id, row]));
  const next = collectOutlineAttachments(flat);
  const dropped = droppedAttachments({
    previouslyAttachedCardIds: loaded.attachedCardIds,
    previouslyAttachedDocumentIds: loaded.attachedDocumentIds,
    nextCardIds: next.cardIds,
    nextDocumentIds: next.documentIds,
  });
  if (dropped.cards.length > 0 || dropped.documents.length > 0) {
    throw AppError.of(400, 'MAP_ORGANIZE_DROPPED', {
      cards: dropped.cards,
      documents: dropped.documents,
    });
  }

  for (const node of flat) {
    if (node.id && !existingById.has(node.id)) {
      throw AppError.of(400, 'MAP_ORGANIZE_INVALID', `未知节点 ${node.id}，新建请省略 id`);
    }
  }

  const allCardIds = [...next.cardIds];
  const allDocIds = [...next.documentIds];
  if (allCardIds.length > 0) {
    const owned = await db
      .select({ id: cards.id, topicId: cards.topicId, userId: cards.userId })
      .from(cards)
      .where(and(eq(cards.userId, opts.userId), inArray(cards.id, allCardIds)));
    if (owned.length !== allCardIds.length) {
      throw AppError.of(400, 'MAP_ORGANIZE_INVALID', '大纲里有不属于你的卡片');
    }
    for (const row of owned) {
      if (row.topicId !== null && row.topicId !== opts.topicId) {
        throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
      }
    }
  }
  if (allDocIds.length > 0) {
    const owned = await db
      .select({ id: documents.id, topicId: documents.topicId })
      .from(documents)
      .where(and(eq(documents.userId, opts.userId), inArray(documents.id, allDocIds)));
    if (owned.length !== allDocIds.length) {
      throw AppError.of(400, 'MAP_ORGANIZE_INVALID', '大纲里有不属于你的资料');
    }
    for (const row of owned) {
      if (row.topicId !== null && row.topicId !== opts.topicId) {
        throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
      }
    }
  }

  const keepIds = new Set(flat.map((node) => node.id).filter((id): id is string => id !== null));

  return db.transaction(async (tx) => {
    const idByKey = new Map<string, string>();
    let created = 0;
    for (const node of flat) {
      if (node.id) {
        idByKey.set(node.key, node.id);
        continue;
      }
      const [row] = await tx
        .insert(mapNodes)
        .values({
          topicId: opts.topicId,
          parentId: null,
          title: node.title,
          note: node.note,
          position: node.position,
          status: 'uncovered',
        })
        .returning();
      if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
      idByKey.set(node.key, row.id);
      created += 1;
    }

    const now = new Date();
    for (const node of flat) {
      const id = idByKey.get(node.key);
      if (!id) throw AppError.of(500, 'INTERNAL_ERROR');
      const parentId = node.parentKey ? (idByKey.get(node.parentKey) ?? null) : null;
      await tx
        .update(mapNodes)
        .set({
          title: node.title,
          note: node.note,
          parentId,
          position: node.position,
        })
        .where(eq(mapNodes.id, id));
    }

    const cardToNode = new Map<string, string>();
    const docToNode = new Map<string, string>();
    for (const node of flat) {
      const id = idByKey.get(node.key);
      if (!id) continue;
      for (const cardId of node.cardIds) cardToNode.set(cardId, id);
      for (const documentId of node.documentIds) docToNode.set(documentId, id);
    }

    for (const [cardId, nodeId] of cardToNode) {
      await tx
        .update(cards)
        .set({ mapNodeId: nodeId, topicId: opts.topicId, updatedAt: now })
        .where(and(eq(cards.id, cardId), eq(cards.userId, opts.userId)));
    }
    for (const [documentId, nodeId] of docToNode) {
      await tx
        .update(documents)
        .set({ mapNodeId: nodeId, topicId: opts.topicId, updatedAt: now })
        .where(and(eq(documents.id, documentId), eq(documents.userId, opts.userId)));
    }

    const nextIds = new Set(idByKey.values());
    const unusedIds = loaded.nodes.map((row) => row.id).filter((id) => !nextIds.has(id));
    let deleted = 0;
    if (unusedIds.length > 0) {
      const removed = await tx
        .delete(mapNodes)
        .where(and(eq(mapNodes.topicId, opts.topicId), inArray(mapNodes.id, unusedIds)))
        .returning({ id: mapNodes.id });
      deleted = removed.length;
    }

    const remaining = await tx.select({ id: mapNodes.id }).from(mapNodes).where(eq(mapNodes.topicId, opts.topicId));
    for (const row of remaining) {
      await recalculateMapNodeStatus(row.id, tx);
    }

    return {
      nodeCount: remaining.length,
      created,
      reused: keepIds.size,
      deleted,
      movedCards: cardToNode.size,
      movedDocuments: docToNode.size,
      blankNodes: flat.filter((node) => node.uncovered || node.cardIds.length === 0).length,
    };
  });
}
