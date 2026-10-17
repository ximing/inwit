import type {
  ConceptNote,
  CreateConceptNoteInput,
  DocumentKnowledge,
  DocumentKnowledgeQuery,
  KnowledgeLocations,
  RemoveDocumentKnowledgeRefInput,
  SetDocumentKnowledgeRefInput,
  UpdateConceptNoteInput,
} from '@inwit/dto';
import {
  createConceptNoteInputSchema,
  setDocumentKnowledgeRefInputSchema,
  updateConceptNoteInputSchema,
} from '@inwit/dto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb, type Database } from '../db/index.js';
import {
  annotations,
  canvasNodes,
  cardKnowledgeLinks,
  cards,
  conceptEvidence,
  conceptNotes,
  conceptOperationRequests,
  conceptPracticeBindings,
  conceptRelations,
  concepts,
  documentKnowledgeRefs,
  documents,
  type ConceptNoteRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { bumpConceptGraphRevision, toPublicConcept, toPublicEvidence, toPublicRelation } from './concept.service.js';
import { resolveQuoteLocation } from './concept-evidence-logic.js';
import { blocksOfDocument } from './concept-evidence.js';
import { requestHashOf } from './concept-identity.js';
import type { z } from 'zod';

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

function toPublicNote(row: ConceptNoteRow): ConceptNote {
  return {
    id: row.id,
    userId: row.userId,
    topicId: row.topicId,
    conceptId: row.conceptId,
    relationId: row.relationId,
    documentId: row.documentId,
    text: row.text,
    version: row.version,
    basis: row.basis,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireOwnedDocument(db: Db, userId: string, documentId: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!row || row.deletedAt) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
  return row;
}

/**
 * 本文知识范围：本文明确收录的概念（direct）、本文收录的关系、关系带出的
 * 端点上下文（endpoint_context）。两个概念同时在本文不引入其他文章的关系。
 */
export async function getDocumentKnowledge(
  userId: string,
  documentId: string,
  query: DocumentKnowledgeQuery,
): Promise<DocumentKnowledge> {
  const db = getDb();
  await requireOwnedDocument(db, userId, documentId);

  const refs = await db
    .select()
    .from(documentKnowledgeRefs)
    .where(
      and(
        eq(documentKnowledgeRefs.userId, userId),
        eq(documentKnowledgeRefs.documentId, documentId),
        eq(documentKnowledgeRefs.topicId, query.topicId),
        isNull(documentKnowledgeRefs.removedAt),
        ...(query.cursor ? [sql`${documentKnowledgeRefs.id} > ${query.cursor}::uuid`] : []),
      ),
    )
    .orderBy(asc(documentKnowledgeRefs.id))
    .limit(query.limit + 1);
  const page = refs.slice(0, query.limit);
  const nextCursor = refs.length > query.limit ? page[page.length - 1]!.id : null;

  const conceptRefIds = page.map((ref) => ref.conceptId).filter((id): id is string => id !== null);
  const relationRefIds = page.map((ref) => ref.relationId).filter((id): id is string => id !== null);

  const conceptRows =
    conceptRefIds.length === 0
      ? []
      : await db
          .select()
          .from(concepts)
          .where(and(inArray(concepts.id, conceptRefIds), isNull(concepts.archivedAt)));
  const relationRows =
    relationRefIds.length === 0
      ? []
      : await db
          .select()
          .from(conceptRelations)
          .where(and(inArray(conceptRelations.id, relationRefIds), isNull(conceptRelations.archivedAt)));

  // 端点上下文：关系带出的概念（未直接收录的标 endpoint_context）
  const endpointIds = new Set<string>();
  for (const relation of relationRows) {
    endpointIds.add(relation.fromConceptId);
    endpointIds.add(relation.toConceptId);
  }
  const directIds = new Set(conceptRows.map((row) => row.id));
  const extraEndpointIds = [...endpointIds].filter((id) => !directIds.has(id));
  const endpointRows =
    extraEndpointIds.length === 0
      ? []
      : await db
          .select()
          .from(concepts)
          .where(and(inArray(concepts.id, extraEndpointIds), isNull(concepts.archivedAt)));
  const conceptById = new Map([...conceptRows, ...endpointRows].map((row) => [row.id, row]));

  const allTargetConceptIds = [...directIds, ...extraEndpointIds];
  const noteRows =
    allTargetConceptIds.length === 0 && relationRows.length === 0
      ? []
      : await db
          .select()
          .from(conceptNotes)
          .where(
            and(
              eq(conceptNotes.documentId, documentId),
              eq(conceptNotes.userId, userId),
            ),
          );
  const evidenceRows = await db
    .select()
    .from(conceptEvidence)
    .where(
      and(
        eq(conceptEvidence.userId, userId),
        eq(conceptEvidence.documentId, documentId),
      ),
    );

  return {
    concepts: [...directIds, ...extraEndpointIds]
      .map((id) => conceptById.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined)
      .map((row) => ({
        concept: toPublicConcept(row),
        membership: directIds.has(row.id) ? ('direct' as const) : ('endpoint_context' as const),
        notes: noteRows.filter((note) => note.conceptId === row.id).map(toPublicNote),
        evidence: evidenceRows.filter((row2) => row2.conceptId === row.id).map(toPublicEvidence),
      })),
    relations: relationRows.map((relation) => ({
      relation: toPublicRelation(relation),
      fromConcept: toPublicConcept(conceptById.get(relation.fromConceptId)!),
      toConcept: toPublicConcept(conceptById.get(relation.toConceptId)!),
      notes: noteRows.filter((note) => note.relationId === relation.id).map(toPublicNote),
      evidence: evidenceRows.filter((row) => row.relationId === relation.id).map(toPublicEvidence),
    })),
    nextCursor,
  };
}

/** 引用已有概念/关系到本文（幂等，不复制实体）。 */
export async function setDocumentKnowledgeRef(
  userId: string,
  documentId: string,
  rawInput: z.input<typeof setDocumentKnowledgeRefInputSchema>,
): Promise<{ refId: string }> {
  const input = setDocumentKnowledgeRefInputSchema.parse(rawInput);
  const requestHash = requestHashOf({ ...input, requestId: undefined, documentId });
  return getDb().transaction(async (tx) => {
    const [existingRequest] = await tx
      .select()
      .from(conceptOperationRequests)
      .where(
        and(
          eq(conceptOperationRequests.userId, userId),
          eq(conceptOperationRequests.operation, 'doc_knowledge_ref'),
          eq(conceptOperationRequests.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (existingRequest) {
      if (existingRequest.requestHash !== requestHash) {
        throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT');
      }
      return existingRequest.responseJson as { refId: string };
    }

    await requireOwnedDocument(tx, userId, documentId);
    let target: { conceptId: string } | { relationId: string };
    if (input.targetKind === 'concept') {
      const [concept] = await tx
        .select()
        .from(concepts)
        .where(
          and(
            eq(concepts.id, input.targetId),
            eq(concepts.userId, userId),
            eq(concepts.topicId, input.topicId),
            isNull(concepts.archivedAt),
          ),
        )
        .limit(1);
      if (!concept) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
      target = { conceptId: concept.id };
    } else {
      const [relation] = await tx
        .select()
        .from(conceptRelations)
        .where(
          and(
            eq(conceptRelations.id, input.targetId),
            eq(conceptRelations.userId, userId),
            eq(conceptRelations.topicId, input.topicId),
            isNull(conceptRelations.archivedAt),
          ),
        )
        .limit(1);
      if (!relation) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
      target = { relationId: relation.id };
    }

    const targetColumn =
      'conceptId' in target ? documentKnowledgeRefs.conceptId : documentKnowledgeRefs.relationId;
    const targetId = 'conceptId' in target ? target.conceptId : target.relationId;
    const [existing] = await tx
      .select()
      .from(documentKnowledgeRefs)
      .where(
        and(
          eq(documentKnowledgeRefs.documentId, documentId),
          eq(documentKnowledgeRefs.topicId, input.topicId),
          eq(targetColumn, targetId),
        ),
      )
      .limit(1);
    let refId: string;
    if (existing) {
      if (existing.removedAt) {
        await tx
          .update(documentKnowledgeRefs)
          .set({ removedAt: null, updatedAt: new Date() })
          .where(eq(documentKnowledgeRefs.id, existing.id));
      }
      refId = existing.id;
    } else {
      const [row] = await tx
        .insert(documentKnowledgeRefs)
        .values({
          userId,
          topicId: input.topicId,
          documentId,
          conceptId: 'conceptId' in target ? target.conceptId : null,
          relationId: 'relationId' in target ? target.relationId : null,
          origin: 'manual',
        })
        .returning();
      if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
      refId = row.id;
    }
    await bumpConceptGraphRevision(tx, input.topicId);
    const result = { refId };
    await tx.insert(conceptOperationRequests).values({
      userId,
      operation: 'doc_knowledge_ref',
      requestId: input.requestId,
      requestHash,
      responseJson: result,
    });
    return result;
  });
}

/**
 * 从本文移除引用：只软删本文引用，不删共享知识、证据或卡片。
 * 移除概念时连带本文涉及它的关系引用，需 confirmDependentRelations 明确确认。
 */
export async function removeDocumentKnowledgeRef(
  userId: string,
  documentId: string,
  refId: string,
  rawInput: RemoveDocumentKnowledgeRefInput,
): Promise<{ removedRefs: number }> {
  return getDb().transaction(async (tx) => {
    const [ref] = await tx
      .select()
      .from(documentKnowledgeRefs)
      .where(
        and(
          eq(documentKnowledgeRefs.id, refId),
          eq(documentKnowledgeRefs.userId, userId),
          eq(documentKnowledgeRefs.documentId, documentId),
          isNull(documentKnowledgeRefs.removedAt),
        ),
      )
      .for('update')
      .limit(1);
    if (!ref) throw AppError.of(404, 'CONCEPT_LINK_NOT_FOUND');

    const now = new Date();
    let removed = 0;
    if (ref.conceptId) {
      // 连带本文关系引用（端点涉及该概念）
      const dependent = await tx
        .select({ id: documentKnowledgeRefs.id })
        .from(documentKnowledgeRefs)
        .innerJoin(
          conceptRelations,
          eq(conceptRelations.id, documentKnowledgeRefs.relationId),
        )
        .where(
          and(
            eq(documentKnowledgeRefs.documentId, documentId),
            isNull(documentKnowledgeRefs.removedAt),
            sql`(${conceptRelations.fromConceptId} = ${ref.conceptId}::uuid OR ${conceptRelations.toConceptId} = ${ref.conceptId}::uuid)`,
          ),
        );
      if (dependent.length > 0 && !rawInput.confirmDependentRelations) {
        throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT', {
          dependentRelationRefs: dependent.map((row) => row.id),
        });
      }
      if (dependent.length > 0) {
        await tx
          .update(documentKnowledgeRefs)
          .set({ removedAt: now, updatedAt: now })
          .where(
            inArray(
              documentKnowledgeRefs.id,
              dependent.map((row) => row.id),
            ),
          );
        removed += dependent.length;
      }
    }
    await tx
      .update(documentKnowledgeRefs)
      .set({ removedAt: now, updatedAt: now })
      .where(eq(documentKnowledgeRefs.id, ref.id));
    removed += 1;
    await bumpConceptGraphRevision(tx, ref.topicId);
    return { removedRefs: removed };
  });
}

/** 新建本文说明（独立 version；不改共享定义）。 */
export async function createConceptNote(
  userId: string,
  rawInput: z.input<typeof createConceptNoteInputSchema>,
): Promise<ConceptNote> {
  const input = createConceptNoteInputSchema.parse(rawInput);
  return getDb().transaction(async (tx) => {
    let topicId: string;
    if (input.targetKind === 'concept') {
      const [concept] = await tx
        .select()
        .from(concepts)
        .where(and(eq(concepts.id, input.targetId), eq(concepts.userId, userId)))
        .limit(1);
      if (!concept) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
      topicId = concept.topicId;
    } else {
      const [relation] = await tx
        .select()
        .from(conceptRelations)
        .where(and(eq(conceptRelations.id, input.targetId), eq(conceptRelations.userId, userId)))
        .limit(1);
      if (!relation) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
      topicId = relation.topicId;
    }
    if (input.documentId) {
      await requireOwnedDocument(tx, userId, input.documentId);
    }
    const [row] = await tx
      .insert(conceptNotes)
      .values({
        userId,
        topicId,
        conceptId: input.targetKind === 'concept' ? input.targetId : null,
        relationId: input.targetKind === 'relation' ? input.targetId : null,
        documentId: input.documentId,
        text: input.text,
        basis: 'user',
        createdBy: 'manual',
      })
      .returning();
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    return toPublicNote(row);
  });
}

/** 更新本文说明：notes 独立 version，不触发知识语义版本与练习失效。 */
export async function updateConceptNote(
  userId: string,
  noteId: string,
  rawInput: z.input<typeof updateConceptNoteInputSchema>,
): Promise<ConceptNote> {
  const input = updateConceptNoteInputSchema.parse(rawInput);
  const [row] = await getDb()
    .update(conceptNotes)
    .set({ text: input.text, version: sql`${conceptNotes.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(conceptNotes.id, noteId),
        eq(conceptNotes.userId, userId),
        eq(conceptNotes.version, input.expectedVersion),
      ),
    )
    .returning();
  if (!row) {
    const [existing] = await getDb()
      .select({ id: conceptNotes.id })
      .from(conceptNotes)
      .where(and(eq(conceptNotes.id, noteId), eq(conceptNotes.userId, userId)))
      .limit(1);
    if (!existing) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
  }
  return toPublicNote(row);
}

/**
 * 位置解析：真实卡片/画布挂载 + 可验证出处 + 引文匹配的批注。
 * 没有脑图节点时 canvasNodeId 为 null（evidence-only，不伪造节点）。
 */
export async function resolveKnowledgeLocations(
  userId: string,
  documentId: string,
  input: { topicId: string; targetKind: 'concept' | 'relation'; targetId: string },
): Promise<KnowledgeLocations> {
  const db = getDb();
  const document = await requireOwnedDocument(db, userId, documentId);

  // 卡片：导航关联或主绑定指向目标、且卡片属于本文
  const linkRows = await db
    .select({
      cardId: cards.id,
      concept: cards.concept,
      deletedAt: cards.deletedAt,
      isPrimary: sql<boolean>`${conceptPracticeBindings.id} IS NOT NULL`,
    })
    .from(cardKnowledgeLinks)
    .innerJoin(cards, eq(cards.id, cardKnowledgeLinks.cardId))
    .leftJoin(
      conceptPracticeBindings,
      and(
        eq(conceptPracticeBindings.cardId, cards.id),
        isNull(conceptPracticeBindings.endedAt),
        input.targetKind === 'concept'
          ? eq(conceptPracticeBindings.conceptId, input.targetId)
          : eq(conceptPracticeBindings.relationId, input.targetId),
      ),
    )
    .where(
      and(
        eq(cardKnowledgeLinks.userId, userId),
        eq(cards.documentId, documentId),
        isNull(cards.deletedAt),
        input.targetKind === 'concept'
          ? eq(cardKnowledgeLinks.conceptId, input.targetId)
          : eq(cardKnowledgeLinks.relationId, input.targetId),
      ),
    );
  const canvasRows = await db
    .select({ id: canvasNodes.id, cardId: canvasNodes.cardId })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.documentId, documentId), sql`${canvasNodes.cardId} IS NOT NULL`));
  const canvasByCard = new Map(canvasRows.map((row) => [row.cardId, row.id]));

  // 证据定位：当前正文中可验证的出处
  const blocks = blocksOfDocument(document);
  const evidenceRows = await db
    .select()
    .from(conceptEvidence)
    .where(
      and(
        eq(conceptEvidence.userId, userId),
        eq(conceptEvidence.documentId, documentId),
        input.targetKind === 'concept'
          ? eq(conceptEvidence.conceptId, input.targetId)
          : eq(conceptEvidence.relationId, input.targetId),
      ),
    );
  const evidence = evidenceRows.map((row) => {
    const resolution = resolveQuoteLocation(blocks, row.locator);
    if (resolution.status === 'resolved') {
      return {
        evidenceId: row.id,
        quote: row.quote,
        status: 'resolved' as const,
        blockIndex: resolution.blockIndex,
        pageIndex: resolution.pageIndex,
      };
    }
    return {
      evidenceId: row.id,
      quote: row.quote,
      status: 'stale' as const,
      blockIndex: null,
      pageIndex: null,
    };
  });

  // 引文匹配的批注（真实锚点，best-effort）
  const annotationRows =
    evidence.length === 0
      ? []
      : await db
          .select({ id: annotations.id, quote: annotations.quote })
          .from(annotations)
          .where(
            and(
              eq(annotations.documentId, documentId),
              eq(annotations.userId, userId),
              isNull(annotations.deletedAt),
              inArray(
                annotations.quote,
                evidenceRows.map((row) => row.quote),
              ),
            ),
          );

  return {
    cards: linkRows.map((row) => ({
      cardId: row.cardId,
      canvasNodeId: canvasByCard.get(row.cardId) ?? null,
      concept: row.concept,
      isPrimaryPractice: row.isPrimary,
    })),
    annotations: annotationRows.map((row) => ({ annotationId: row.id, quote: row.quote })),
    evidence,
  };
}
