import type { MemoryContent } from '@inwit/dto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import { cards, documents, mapNodes, memories, type MapNodeRow } from '../db/schema.js';

export const TOPIC_MAP_SNAPSHOT_BEFORE = 'snapshot:before';
export const TOPIC_MAP_SNAPSHOT_AFTER = 'snapshot:after';

export interface TopicMapSnapshotNode {
  id: string;
  parentId: string | null;
  title: string;
  note: string | null;
  position: number;
  status: string;
  cardIds: string[];
  documentIds: string[];
}

export interface TopicMapSnapshot {
  jobId: string;
  action: 'organize';
  takenAt: string;
  cardCount: number;
  documentCount: number;
  attachedCardIds: string[];
  attachedDocumentIds: string[];
  nodes: TopicMapSnapshotNode[];
}

type SnapshotDb = Pick<Database, 'select' | 'insert' | 'update'>;

export async function loadTopicMapSnapshot(topicId: string, db: SnapshotDb = getDb()): Promise<{
  nodes: MapNodeRow[];
  cardIdsByNode: Map<string, string[]>;
  documentIdsByNode: Map<string, string[]>;
  attachedCardIds: string[];
  attachedDocumentIds: string[];
}> {
  const nodes = await db.select().from(mapNodes).where(eq(mapNodes.topicId, topicId));
  const nodeIds = nodes.map((row) => row.id);
  const cardIdsByNode = new Map<string, string[]>();
  const documentIdsByNode = new Map<string, string[]>();
  for (const id of nodeIds) {
    cardIdsByNode.set(id, []);
    documentIdsByNode.set(id, []);
  }

  const attachedCardIds: string[] = [];
  const attachedDocumentIds: string[] = [];
  if (nodeIds.length > 0) {
    const cardRows = await db
      .select({ id: cards.id, mapNodeId: cards.mapNodeId })
      .from(cards)
      .where(and(inArray(cards.mapNodeId, nodeIds), isNull(cards.deletedAt)));
    for (const row of cardRows) {
      if (!row.mapNodeId) continue;
      const list = cardIdsByNode.get(row.mapNodeId);
      if (!list) continue;
      list.push(row.id);
      attachedCardIds.push(row.id);
    }

    const docRows = await db
      .select({ id: documents.id, mapNodeId: documents.mapNodeId })
      .from(documents)
      .where(inArray(documents.mapNodeId, nodeIds));
    for (const row of docRows) {
      if (!row.mapNodeId) continue;
      const list = documentIdsByNode.get(row.mapNodeId);
      if (!list) continue;
      list.push(row.id);
      attachedDocumentIds.push(row.id);
    }
  }

  return { nodes, cardIdsByNode, documentIdsByNode, attachedCardIds, attachedDocumentIds };
}

export function buildTopicMapSnapshot(opts: {
  jobId: string;
  takenAt?: Date;
  nodes: MapNodeRow[];
  cardIdsByNode: Map<string, string[]>;
  documentIdsByNode: Map<string, string[]>;
  attachedCardIds: string[];
  attachedDocumentIds: string[];
}): TopicMapSnapshot {
  const snapshotNodes: TopicMapSnapshotNode[] = opts.nodes
    .slice()
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((row) => ({
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      note: row.note ?? null,
      position: row.position,
      status: row.status,
      cardIds: opts.cardIdsByNode.get(row.id) ?? [],
      documentIds: opts.documentIdsByNode.get(row.id) ?? [],
    }));
  return {
    jobId: opts.jobId,
    action: 'organize',
    takenAt: (opts.takenAt ?? new Date()).toISOString(),
    cardCount: opts.attachedCardIds.length,
    documentCount: opts.attachedDocumentIds.length,
    attachedCardIds: opts.attachedCardIds,
    attachedDocumentIds: opts.attachedDocumentIds,
    nodes: snapshotNodes,
  };
}

export function snapshotToMemoryContent(snapshot: TopicMapSnapshot): MemoryContent {
  return snapshot as unknown as MemoryContent;
}

export async function upsertTopicMapMemory(opts: {
  userId: string;
  topicId: string;
  key: string;
  content: MemoryContent;
  db?: SnapshotDb;
}): Promise<void> {
  const db = opts.db ?? getDb();
  const now = new Date();
  const [existing] = await db
    .select({ id: memories.id })
    .from(memories)
    .where(
      and(
        eq(memories.userId, opts.userId),
        eq(memories.scope, 'topic'),
        eq(memories.scopeId, opts.topicId),
        eq(memories.layer, 'topic_map'),
        eq(memories.key, opts.key),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .update(memories)
      .set({ content: opts.content, updatedAt: now })
      .where(eq(memories.id, existing.id));
    return;
  }
  await db.insert(memories).values({
    userId: opts.userId,
    scope: 'topic',
    scopeId: opts.topicId,
    layer: 'topic_map',
    key: opts.key,
    content: opts.content,
  });
}

export async function captureTopicMapSnapshot(opts: {
  userId: string;
  topicId: string;
  jobId: string;
  key: string;
  db?: SnapshotDb;
}): Promise<TopicMapSnapshot> {
  const db = opts.db ?? getDb();
  const loaded = await loadTopicMapSnapshot(opts.topicId, db);
  const snapshot = buildTopicMapSnapshot({ jobId: opts.jobId, ...loaded });
  await upsertTopicMapMemory({
    userId: opts.userId,
    topicId: opts.topicId,
    key: opts.key,
    content: snapshotToMemoryContent(snapshot),
    db,
  });
  return snapshot;
}
