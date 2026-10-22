import type { ConceptGraphPage, ConceptGraphViewResult } from '@inwit/dto';
import { CONCEPT_GRAPH_EDGE_PAGE } from '@inwit/dto';
import { conceptGraphQuerySchema, conceptGraphViewInputSchema } from '@inwit/dto';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  conceptRelations,
  concepts,
  documentKnowledgeRefs,
  topics,
  type ConceptRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import {
  conceptKeysetAfter,
  decodeCursor,
  encodeCursor,
  preciseCreatedAt,
  type Db,
} from './concept-access.js';
import { graphViewScopeHash } from './concept-identity.js';
import { toPublicConcept, toPublicRelation } from './concept-public.js';

/** 服务入口接受 zod 输入类型（含默认值字段可省略），边界处统一 parse。 */
type ConceptGraphRawQuery = z.input<typeof conceptGraphQuerySchema>;
type ConceptGraphViewRawInput = z.input<typeof conceptGraphViewInputSchema>;

async function neighborCounts(
  db: Db,
  topicId: string,
  conceptIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (conceptIds.length === 0) return counts;
  const rows = await db
    .select({
      fromId: conceptRelations.fromConceptId,
      toId: conceptRelations.toConceptId,
    })
    .from(conceptRelations)
    .where(
      and(
        eq(conceptRelations.topicId, topicId),
        isNull(conceptRelations.archivedAt),
        or(
          inArray(conceptRelations.fromConceptId, conceptIds),
          inArray(conceptRelations.toConceptId, conceptIds),
        ),
      ),
    );
  for (const row of rows) {
    if (conceptIds.includes(row.fromId)) {
      counts.set(row.fromId, (counts.get(row.fromId) ?? 0) + 1);
    }
    if (conceptIds.includes(row.toId)) {
      counts.set(row.toId, (counts.get(row.toId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * 图节点分页：只负责发现节点与邻居数量，不声称关系已完整。
 * focusId 模式返回焦点 + 相邻节点（按概念创建顺序），用偏移游标继续。
 */
export async function getConceptGraph(
  userId: string,
  topicId: string,
  rawQuery: ConceptGraphRawQuery,
): Promise<ConceptGraphPage> {
  const query = conceptGraphQuerySchema.parse(rawQuery);
  const topic = await getOwnedTopic(userId, topicId);
  const db = getDb();

  let pageRows: ConceptRow[] = [];
  let nextCursor: string | null = null;

  if (query.focusId) {
    const [focus] = await db
      .select()
      .from(concepts)
      .where(
        and(
          eq(concepts.id, query.focusId),
          eq(concepts.userId, userId),
          eq(concepts.topicId, topicId),
          isNull(concepts.archivedAt),
        ),
      )
      .limit(1);
    if (!focus) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    const adjacent = await db
      .select({ fromId: conceptRelations.fromConceptId, toId: conceptRelations.toConceptId })
      .from(conceptRelations)
      .where(
        and(
          eq(conceptRelations.topicId, topicId),
          isNull(conceptRelations.archivedAt),
          or(
            eq(conceptRelations.fromConceptId, focus.id),
            eq(conceptRelations.toConceptId, focus.id),
          ),
        ),
      );
    const neighborIds = new Set<string>();
    for (const relation of adjacent) {
      if (relation.fromId !== focus.id) neighborIds.add(relation.fromId);
      if (relation.toId !== focus.id) neighborIds.add(relation.toId);
    }
    const neighbors =
      neighborIds.size === 0
        ? []
        : await db
            .select()
            .from(concepts)
            .where(and(inArray(concepts.id, [...neighborIds]), isNull(concepts.archivedAt)))
            .orderBy(asc(concepts.createdAt), asc(concepts.id));
    const offset = (() => {
      if (!query.cursor) return 0;
      const decoded = decodeCursor(query.cursor);
      const value = decoded?.['o'];
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
    })();
    // 焦点固定在每页首位，便于客户端保留焦点上下文。
    const ordered = [focus, ...neighbors];
    pageRows = ordered.slice(offset, offset + query.limit);
    nextCursor =
      offset + query.limit < ordered.length ? encodeCursor({ o: offset + query.limit }) : null;
  } else {
    const conditions: SQL[] = [
      eq(concepts.userId, userId),
      eq(concepts.topicId, topicId),
      isNull(concepts.archivedAt),
    ];
    if (query.documentId) {
      // 本文范围：本文明确收录的概念，以及本文收录关系带出的端点（endpoint_context）。
      conditions.push(
        sql`(
          EXISTS (SELECT 1 FROM ${documentKnowledgeRefs} WHERE ${documentKnowledgeRefs.documentId} = ${query.documentId} AND ${documentKnowledgeRefs.conceptId} = ${concepts.id} AND ${documentKnowledgeRefs.removedAt} IS NULL)
          OR EXISTS (
            SELECT 1 FROM ${documentKnowledgeRefs} dkr
            JOIN ${conceptRelations} cr ON cr.id = dkr.relation_id
            WHERE dkr.document_id = ${query.documentId} AND dkr.removed_at IS NULL
              AND (cr.from_concept_id = ${concepts.id} OR cr.to_concept_id = ${concepts.id})
          )
        )`,
      );
    }
    if (query.cursor) {
      conditions.push(conceptKeysetAfter(query.cursor));
    }
    const rows = await db
      .select()
      .from(concepts)
      .where(and(...conditions))
      .orderBy(asc(concepts.createdAt), asc(concepts.id))
      .limit(query.limit + 1);
    pageRows = rows.slice(0, query.limit);
    const last = pageRows[pageRows.length - 1];
    nextCursor =
      rows.length > query.limit && last
        ? encodeCursor({ c: await preciseCreatedAt(db, last.id), i: last.id })
        : null;
  }

  const counts = await neighborCounts(
    db,
    topicId,
    pageRows.map((row) => row.id),
  );
  // 本文范围：区分明确收录与关系带出的端点上下文
  let directIds = new Set<string>();
  if (query.documentId && pageRows.length > 0) {
    const directRows = await db
      .select({ conceptId: documentKnowledgeRefs.conceptId })
      .from(documentKnowledgeRefs)
      .where(
        and(
          eq(documentKnowledgeRefs.documentId, query.documentId),
          isNull(documentKnowledgeRefs.removedAt),
          inArray(
            documentKnowledgeRefs.conceptId,
            pageRows.map((row) => row.id),
          ),
        ),
      );
    directIds = new Set(directRows.map((row) => row.conceptId).filter((id): id is string => id !== null));
  }
  return {
    nodes: pageRows.map((row) => ({
      concept: toPublicConcept(row),
      neighborCount: counts.get(row.id) ?? 0,
      membership: query.documentId && !directIds.has(row.id) ? ('endpoint_context' as const) : ('direct' as const),
    })),
    nextCursor,
    graphRevision: topic.conceptGraphRevision,
  };
}

/**
 * 显式可见集合的边分页。revision 与游标绑定校验在同一可重复读快照内完成，
 * 版本或可见集合变化返回 409 GRAPH_VIEW_CHANGED，不混合两个版本的边。
 */
export async function postConceptGraphView(
  userId: string,
  topicId: string,
  rawInput: ConceptGraphViewRawInput,
): Promise<ConceptGraphViewResult> {
  const input = conceptGraphViewInputSchema.parse(rawInput);
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const [topic] = await tx
      .select()
      .from(topics)
      .where(and(eq(topics.id, topicId), eq(topics.userId, userId)))
      .limit(1);
    if (!topic) throw AppError.of(404, 'TOPIC_NOT_FOUND');
    if (topic.conceptGraphRevision !== input.expectedGraphRevision) {
      throw AppError.of(409, 'GRAPH_VIEW_CHANGED');
    }
    const nodeIds = [...new Set(input.nodeIds)];
    const found = await tx
      .select({ id: concepts.id })
      .from(concepts)
      .where(
        and(
          inArray(concepts.id, nodeIds),
          eq(concepts.userId, userId),
          eq(concepts.topicId, topicId),
          isNull(concepts.archivedAt),
        ),
      );
    if (found.length !== nodeIds.length) throw AppError.of(404, 'CONCEPT_NOT_FOUND');

    const scopeHash = graphViewScopeHash({
      userId,
      topicId,
      documentId: input.documentId ?? null,
      nodeIds,
    });
    let lastRelationId: string | null = null;
    if (input.edgeCursor) {
      const decoded = decodeCursor(input.edgeCursor);
      const revision = decoded?.['r'];
      const scope = decoded?.['s'];
      const last = decoded?.['l'];
      if (
        revision !== topic.conceptGraphRevision ||
        scope !== scopeHash ||
        typeof last !== 'string'
      ) {
        throw AppError.of(409, 'GRAPH_VIEW_CHANGED');
      }
      lastRelationId = last;
    }

    const conditions: SQL[] = [
      eq(conceptRelations.userId, userId),
      eq(conceptRelations.topicId, topicId),
      isNull(conceptRelations.archivedAt),
      inArray(conceptRelations.fromConceptId, nodeIds),
      inArray(conceptRelations.toConceptId, nodeIds),
    ];
    if (input.documentId) {
      // 本文范围内只纳入本文收录的关系；两端点同在本文不足以引入其他文章的边。
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${documentKnowledgeRefs} WHERE ${documentKnowledgeRefs.documentId} = ${input.documentId} AND ${documentKnowledgeRefs.relationId} = ${conceptRelations.id} AND ${documentKnowledgeRefs.removedAt} IS NULL)`,
      );
    }
    if (lastRelationId) {
      conditions.push(sql`${conceptRelations.id} > ${lastRelationId}::uuid`);
    }
    const rows = await tx
      .select()
      .from(conceptRelations)
      .where(and(...conditions))
      .orderBy(asc(conceptRelations.id))
      .limit(CONCEPT_GRAPH_EDGE_PAGE + 1);
    const page = rows.slice(0, CONCEPT_GRAPH_EDGE_PAGE);
    const last = page[page.length - 1];
    const nextEdgeCursor =
      rows.length > CONCEPT_GRAPH_EDGE_PAGE && last
        ? encodeCursor({ r: topic.conceptGraphRevision, s: scopeHash, l: last.id })
        : null;
    return {
      edges: page.map(toPublicRelation),
      nextEdgeCursor,
      graphRevision: topic.conceptGraphRevision,
    };
  });
}
