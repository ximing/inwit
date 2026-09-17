import type {
  CreateMapNodeInput,
  MapNode,
  MapNodeDetail,
  MapSummary,
  MapTree,
  ReviewFeedback,
  UpdateMapNodeInput,
} from '@inwit/dto';
import { MAP_MAX_DEPTH, docDisplayTitle } from '@inwit/dto';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { toCardSummary } from '../cards/card.mapper.js';
import { getDb, type Database } from '../db/index.js';
import {
  cards,
  documents,
  mapNodes,
  reviewStates,
  topics,
  type MapNodeRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { masteryPct, nodeMastery, statusFromMastery } from './mastery.js';
import {
  assembleMapTree,
  flattenMapTree,
  depthFromRoot,
  parentChainContains,
  subtreeRelativeHeight,
  type MapPathNode,
} from './tree.js';
import type { PlaceTarget } from './outline.js';


export type MapDb = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

interface NodeStats {
  cardCount: number;
  docCount: number;
  mastery: number;
  feedbacks: Array<ReviewFeedback | null>;
}

function emptyStats(): NodeStats {
  return { cardCount: 0, docCount: 0, mastery: 0, feedbacks: [] };
}

function toPublicMapNode(row: MapNodeRow, stats: NodeStats): MapNode {
  const mastery = stats.mastery;
  return {
    id: row.id,
    topicId: row.topicId,
    parentId: row.parentId,
    title: row.title,
    status: statusFromMastery(stats.cardCount, mastery),
    note: row.note ?? null,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    cardCount: stats.cardCount,
    docCount: stats.docCount,
    mastery,
  };
}

export async function getOwnedMapNode(
  userId: string,
  nodeId: string,
  db: MapDb = getDb(),
): Promise<MapNodeRow> {
  const [row] = await db
    .select({ node: mapNodes })
    .from(mapNodes)
    .innerJoin(topics, eq(topics.id, mapNodes.topicId))
    .where(and(eq(mapNodes.id, nodeId), eq(topics.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'MAP_NODE_NOT_FOUND');
  return row.node;
}

export async function requireWritableMapNode(
  userId: string,
  nodeId: string,
  db: MapDb = getDb(),
): Promise<MapNodeRow> {
  const node = await getOwnedMapNode(userId, nodeId, db);
  await assertWritableTopic(userId, node.topicId);
  return node;
}

async function assertWritableTopic(userId: string, topicId: string): Promise<void> {
  const topic = await getOwnedTopic(userId, topicId);
  if (topic.status === 'archived') throw AppError.of(409, 'TOPIC_ARCHIVED');
}

async function nextPosition(topicId: string, parentId: string | null, db: MapDb): Promise<number> {
  const parentFilter =
    parentId === null ? isNull(mapNodes.parentId) : eq(mapNodes.parentId, parentId);
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${mapNodes.position}), -1)::int` })
    .from(mapNodes)
    .where(and(eq(mapNodes.topicId, topicId), parentFilter));
  return Number(row?.max ?? -1) + 1;
}

async function loadTopicNodeRows(topicId: string, db: MapDb): Promise<MapNodeRow[]> {
  return db.select().from(mapNodes).where(eq(mapNodes.topicId, topicId));
}

function indexParents(rows: Array<{ id: string; parentId: string | null }>): {
  parentOf: Map<string, string | null>;
  childrenOf: Map<string, { id: string }[]>;
} {
  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, { id: string }[]>();
  for (const row of rows) {
    parentOf.set(row.id, row.parentId);
    if (row.parentId) {
      const list = childrenOf.get(row.parentId) ?? [];
      list.push({ id: row.id });
      childrenOf.set(row.parentId, list);
    }
  }
  return { parentOf, childrenOf };
}

async function assertPlaceable(opts: {
  topicId: string;
  nodeId?: string;
  parentId: string | null;
  db: MapDb;
}): Promise<void> {
  const { topicId, nodeId, parentId, db } = opts;
  if (parentId === null) {
    if (nodeId) {
      const rows = await loadTopicNodeRows(topicId, db);
      const { childrenOf } = indexParents(rows);
      const down = subtreeRelativeHeight(nodeId, childrenOf);
      if (1 + down > MAP_MAX_DEPTH) throw AppError.of(400, 'MAP_NODE_INVALID_PARENT');
    }
    return;
  }
  if (parentId === nodeId) throw AppError.of(400, 'MAP_NODE_INVALID_PARENT');

  const [parent] = await db
    .select()
    .from(mapNodes)
    .where(and(eq(mapNodes.id, parentId), eq(mapNodes.topicId, topicId)))
    .limit(1);
  if (!parent) throw AppError.of(400, 'MAP_NODE_INVALID_PARENT');

  const rows = await loadTopicNodeRows(topicId, db);
  const { parentOf, childrenOf } = indexParents(rows);
  if (nodeId && parentChainContains(parentId, nodeId, parentOf)) {
    throw AppError.of(400, 'MAP_NODE_INVALID_PARENT');
  }
  const parentDepth = depthFromRoot(parent.id, parentOf);
  const newDepth = parentDepth + 1;
  const down = nodeId ? subtreeRelativeHeight(nodeId, childrenOf) : 0;
  if (newDepth + down > MAP_MAX_DEPTH) throw AppError.of(400, 'MAP_NODE_INVALID_PARENT');
}

async function loadStatsByNode(
  nodeIds: string[],
  db: MapDb,
): Promise<Map<string, NodeStats>> {
  const stats = new Map<string, NodeStats>();
  for (const id of nodeIds) stats.set(id, emptyStats());
  if (nodeIds.length === 0) return stats;

  const cardRows = await db
    .select({
      mapNodeId: cards.mapNodeId,
      lastFeedback: reviewStates.lastFeedback,
    })
    .from(cards)
    .leftJoin(
      reviewStates,
      and(eq(reviewStates.cardId, cards.id), eq(reviewStates.userId, cards.userId)),
    )
    .where(and(inArray(cards.mapNodeId, nodeIds), isNull(cards.deletedAt)));

  for (const row of cardRows) {
    if (!row.mapNodeId) continue;
    const current = stats.get(row.mapNodeId) ?? emptyStats();
    current.cardCount += 1;
    current.feedbacks.push(row.lastFeedback ?? null);
    stats.set(row.mapNodeId, current);
  }
  for (const current of stats.values()) {
    current.mastery = nodeMastery(current.feedbacks);
  }

  const docRows = await db
    .select({ mapNodeId: documents.mapNodeId, n: count() })
    .from(documents)
    .where(inArray(documents.mapNodeId, nodeIds))
    .groupBy(documents.mapNodeId);

  for (const row of docRows) {
    if (!row.mapNodeId) continue;
    const current = stats.get(row.mapNodeId) ?? emptyStats();
    current.docCount = Number(row.n);
    stats.set(row.mapNodeId, current);
  }

  return stats;
}

async function statsForNode(nodeId: string, db: MapDb): Promise<NodeStats> {
  const map = await loadStatsByNode([nodeId], db);
  return map.get(nodeId) ?? emptyStats();
}

export async function recalculateMapNodeStatus(
  nodeId: string,
  db: MapDb = getDb(),
): Promise<void> {
  const stats = await statsForNode(nodeId, db);
  const status = statusFromMastery(stats.cardCount, stats.mastery);
  await db.update(mapNodes).set({ status }).where(eq(mapNodes.id, nodeId));
}

export async function getTopicMap(userId: string, topicId: string): Promise<MapTree> {
  await getOwnedTopic(userId, topicId);
  const rows = await loadTopicNodeRows(topicId, getDb());
  const stats = await loadStatsByNode(
    rows.map((row) => row.id),
    getDb(),
  );
  const nodes = rows.map((row) => toPublicMapNode(row, stats.get(row.id) ?? emptyStats()));
  return { nodes: assembleMapTree(nodes) };
}

export async function getMapNodeDetail(userId: string, nodeId: string): Promise<MapNodeDetail> {
  const row = await getOwnedMapNode(userId, nodeId);
  const db = getDb();
  const stats = await statsForNode(nodeId, db);
  const cardRows = await db
    .select({
      id: cards.id,
      documentId: cards.documentId,
      concept: cards.concept,
      tags: cards.tags,
    })
    .from(cards)
    .where(and(eq(cards.userId, userId), eq(cards.mapNodeId, nodeId), isNull(cards.deletedAt)))
    .orderBy(asc(cards.createdAt), asc(cards.id));
  const docRows = await db
    .select({
      id: documents.id,
      title: documents.title,
      description: documents.description,
      status: documents.status,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(and(eq(documents.userId, userId), eq(documents.mapNodeId, nodeId)))
    .orderBy(desc(documents.updatedAt), desc(documents.id));
  return {
    node: toPublicMapNode(row, stats),
    cards: cardRows.map((card) => toCardSummary(card)),
    documents: docRows.map((doc) => ({
      id: doc.id,
      title: docDisplayTitle(doc),
      status: doc.status,
      updatedAt: doc.updatedAt.toISOString(),
    })),
  };
}

export async function getTopicMapFlat(userId: string, topicId: string): Promise<MapPathNode[]> {
  const tree = await getTopicMap(userId, topicId);
  return flattenMapTree(tree.nodes);
}

export async function placeCardOnMap(
  userId: string,
  cardId: string,
  target: PlaceTarget,
): Promise<{ nodeId: string; created: boolean; title: string }> {
  const db = getDb();
  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId), isNull(cards.deletedAt)))
    .limit(1);
  if (!card) throw AppError.of(404, 'CARD_NOT_FOUND');

  let node: MapNodeRow;
  let created = false;
  if (target.kind === 'existing') {
    node = await requireWritableMapNode(userId, target.nodeId);
    if (card.topicId !== null && card.topicId !== node.topicId) {
      throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
    }
  } else {
    let topicId = card.topicId;
    if (target.parentId) {
      const parent = await requireWritableMapNode(userId, target.parentId);
      if (card.topicId !== null && card.topicId !== parent.topicId) {
        throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
      }
      topicId = parent.topicId;
    }
    if (!topicId) throw AppError.of(409, 'MAP_NODE_TOPIC_MISMATCH');
    const createdNode = await createMapNode(userId, topicId, {
      title: target.title,
      ...(target.parentId ? { parentId: target.parentId } : {}),
    });
    node = await getOwnedMapNode(userId, createdNode.id);
    created = true;
  }

  const oldNodeId = card.mapNodeId;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(cards)
      .set({
        mapNodeId: node.id,
        ...(card.topicId === null ? { topicId: node.topicId } : {}),
        updatedAt: now,
      })
      .where(and(eq(cards.id, cardId), eq(cards.userId, userId)));

    if (card.documentId) {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, card.documentId), eq(documents.userId, userId)))
        .limit(1);
      if (
        doc &&
        doc.mapNodeId === null &&
        (doc.topicId === null || doc.topicId === node.topicId)
      ) {
        await tx
          .update(documents)
          .set({
            mapNodeId: node.id,
            ...(doc.topicId === null ? { topicId: node.topicId } : {}),
            updatedAt: now,
          })
          .where(eq(documents.id, doc.id));
      }
    }

    const touched = new Set<string>();
    if (oldNodeId) touched.add(oldNodeId);
    touched.add(node.id);
    for (const id of touched) {
      await recalculateMapNodeStatus(id, tx);
    }
  });

  return { nodeId: node.id, created, title: node.title };
}

export async function getTopicMapSummary(userId: string, topicId: string): Promise<MapSummary> {
  await getOwnedTopic(userId, topicId);
  const rows = await loadTopicNodeRows(topicId, getDb());
  const stats = await loadStatsByNode(
    rows.map((row) => row.id),
    getDb(),
  );
  const allFeedbacks: Array<ReviewFeedback | null> = [];
  let uncoveredNodes = 0;
  let cardCount = 0;
  for (const row of rows) {
    const nodeStats = stats.get(row.id) ?? emptyStats();
    cardCount += nodeStats.cardCount;
    allFeedbacks.push(...nodeStats.feedbacks);
    if (statusFromMastery(nodeStats.cardCount, nodeStats.mastery) === 'uncovered') {
      uncoveredNodes += 1;
    }
  }
  return {
    totalNodes: rows.length,
    uncoveredNodes,
    cardCount,
    masteryPct: masteryPct(allFeedbacks),
  };
}

export async function createMapNode(
  userId: string,
  topicId: string,
  input: CreateMapNodeInput,
): Promise<MapNode> {
  await assertWritableTopic(userId, topicId);
  const parentId = input.parentId ?? null;
  const db = getDb();
  await assertPlaceable({ topicId, parentId, db });
  const position = await nextPosition(topicId, parentId, db);
  const [row] = await db
    .insert(mapNodes)
    .values({
      topicId,
      parentId,
      title: input.title,
      note: blankToNull(input.note),
      position,
      status: 'uncovered',
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return toPublicMapNode(row, emptyStats());
}

export async function updateMapNode(
  userId: string,
  nodeId: string,
  input: UpdateMapNodeInput,
): Promise<MapNode> {
  const existing = await getOwnedMapNode(userId, nodeId);
  await assertWritableTopic(userId, existing.topicId);
  const db = getDb();

  let parentId = existing.parentId;
  if (input.parentId !== undefined) parentId = input.parentId;

  if (input.parentId !== undefined && input.parentId !== existing.parentId) {
    await assertPlaceable({ topicId: existing.topicId, nodeId, parentId, db });
  }

  let position = input.position;
  if (position === undefined && input.parentId !== undefined && input.parentId !== existing.parentId) {
    position = await nextPosition(existing.topicId, parentId, db);
  }

  const [row] = await db
    .update(mapNodes)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.note !== undefined ? { note: blankToNull(input.note) } : {}),
      ...(input.parentId !== undefined ? { parentId } : {}),
      ...(position !== undefined ? { position } : {}),
    })
    .where(eq(mapNodes.id, nodeId))
    .returning();
  if (!row) throw AppError.of(404, 'MAP_NODE_NOT_FOUND');
  const stats = await statsForNode(nodeId, db);
  return toPublicMapNode(row, stats);
}

/**
 * Deletes the node and descendants (`parent_id` ON DELETE CASCADE).
 * Cards and documents on the subtree have `map_node_id` set to NULL (FK ON DELETE SET NULL).
 */
export async function deleteMapNode(userId: string, nodeId: string): Promise<void> {
  const existing = await getOwnedMapNode(userId, nodeId);
  await assertWritableTopic(userId, existing.topicId);
  await getDb().delete(mapNodes).where(eq(mapNodes.id, nodeId));
}
