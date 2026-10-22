import type {
  Concept,
  ConceptArchiveResult,
  ConceptDetail,
  ConceptMatch,
  ConceptRelation,
  ConceptRelationDetail,
  CreateConceptRelationInput,
  CreateConceptRelationResult,
  CreateConceptResult,
  RelationArchiveResult,
  SaveConceptBundleResult,
  UpdateConceptInput,
  UpdateConceptRelationInput,
} from '@inwit/dto';
import {
  createConceptInputSchema,
  createConceptRelationInputSchema,
  listConceptsQuerySchema,
  saveConceptBundleInputSchema,
} from '@inwit/dto';
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb } from '../db/index.js';
import {
  conceptEvidence,
  conceptNotes,
  conceptOperationRequests,
  conceptPracticeBindings,
  conceptRelations,
  concepts,
  documentKnowledgeRefs,
  documents,
  type ConceptRelationRow,
  type ConceptRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { bumpManagedCardRevisions } from './concept-review-revision.js';
import {
  bumpConceptGraphRevision,
  conceptKeysetAfter,
  encodeCursor,
  getOwnedConcept,
  getOwnedRelation,
  lockActiveTopic,
  preciseCreatedAt,
  type Db,
} from './concept-access.js';
import {
  insertEvidenceForTarget,
  type ConceptSourceSnapshot,
  type EvidenceWriteItem,
} from './concept-evidence.js';
import { conceptMatchKind, normalizeConceptName, relationIdentityHash, requestHashOf } from './concept-identity.js';
import { getConceptPracticeSummary } from './concept-practice.service.js';
import { toPublicConcept, toPublicEvidence, toPublicRelation } from './concept-public.js';

/** 服务入口接受 zod 输入类型（含默认值字段可省略），边界处统一 parse。 */
type CreateConceptRawInput = z.input<typeof createConceptInputSchema>;
type CreateRelationRawInput = z.input<typeof createConceptRelationInputSchema>;
type SaveBundleRawInput = z.input<typeof saveConceptBundleInputSchema>;
type ListConceptsRawQuery = z.input<typeof listConceptsQuerySchema>;

/** 概念语义字段（name/sense/definition/example/aliases）变化时递增版本。 */
function conceptSemanticChanged(row: ConceptRow, input: UpdateConceptInput): boolean {
  if (input.name !== undefined && input.name !== row.name) return true;
  if (input.sense !== undefined && input.sense !== row.sense) return true;
  if (input.definition !== undefined && input.definition !== row.definition) return true;
  if (input.example !== undefined && input.example !== row.example) return true;
  if (input.aliases !== undefined) {
    if (input.aliases.length !== row.aliases.length) return true;
    const sorted = [...input.aliases].sort();
    const current = [...row.aliases].sort();
    for (let i = 0; i < sorted.length; i += 1) if (sorted[i] !== current[i]) return true;
  }
  return false;
}

/** 关系语义变化：kind/predicate/context/explanation/example。 */
function relationSemanticChanged(row: ConceptRelationRow, input: UpdateConceptRelationInput): boolean {
  if (input.kind !== undefined && input.kind !== row.kind) return true;
  if (input.predicate !== undefined && input.predicate !== row.predicate) return true;
  if (input.context !== undefined && input.context !== row.context) return true;
  if (input.explanation !== undefined && input.explanation !== row.explanation) return true;
  if (input.example !== undefined && input.example !== row.example) return true;
  return false;
}

/** 目标语义变化时：相邻活动关系版本递增（概念变化），相关练习标 needsRefresh 并轮换卡片版本。 */
async function markPracticesStale(
  db: Db,
  input: { conceptIds?: string[]; relationIds?: string[] },
): Promise<void> {
  const conditions: SQL[] = [];
  if (input.conceptIds && input.conceptIds.length > 0) {
    conditions.push(inArray(conceptPracticeBindings.conceptId, input.conceptIds));
  }
  if (input.relationIds && input.relationIds.length > 0) {
    conditions.push(inArray(conceptPracticeBindings.relationId, input.relationIds));
  }
  if (conditions.length === 0) return;
  const affected = await db
    .update(conceptPracticeBindings)
    .set({ needsRefresh: true, updatedAt: new Date() })
    .where(and(isNull(conceptPracticeBindings.endedAt), or(...conditions)))
    .returning({ cardId: conceptPracticeBindings.cardId });
  await bumpManagedCardRevisions(
    db,
    affected.map((row) => row.cardId),
  );
}

/** 归档/恢复时标记活动绑定需要显式恢复（resumeRequired），并轮换卡片版本。 */
async function markPracticesResumeRequired(
  db: Db,
  input: { conceptIds?: string[]; relationIds?: string[] },
): Promise<number> {
  const conditions: SQL[] = [];
  if (input.conceptIds && input.conceptIds.length > 0) {
    conditions.push(inArray(conceptPracticeBindings.conceptId, input.conceptIds));
  }
  if (input.relationIds && input.relationIds.length > 0) {
    conditions.push(inArray(conceptPracticeBindings.relationId, input.relationIds));
  }
  if (conditions.length === 0) return 0;
  const rows = await db
    .update(conceptPracticeBindings)
    .set({ resumeRequired: true, updatedAt: new Date() })
    .where(and(isNull(conceptPracticeBindings.endedAt), or(...conditions)))
    .returning({ id: conceptPracticeBindings.id, cardId: conceptPracticeBindings.cardId });
  await bumpManagedCardRevisions(
    db,
    rows.map((row) => row.cardId),
  );
  return rows.length;
}

/** 按目标找活动绑定并轮换其卡片版本（归档/恢复/语义变更共用）。 */
async function rotateCardRevisionsForTargets(
  db: Db,
  input: { conceptIds?: string[]; relationIds?: string[] },
): Promise<void> {
  const conditions: SQL[] = [];
  if (input.conceptIds && input.conceptIds.length > 0) {
    conditions.push(inArray(conceptPracticeBindings.conceptId, input.conceptIds));
  }
  if (input.relationIds && input.relationIds.length > 0) {
    conditions.push(inArray(conceptPracticeBindings.relationId, input.relationIds));
  }
  if (conditions.length === 0) return;
  const rows = await db
    .select({ cardId: conceptPracticeBindings.cardId })
    .from(conceptPracticeBindings)
    .where(and(isNull(conceptPracticeBindings.endedAt), or(...conditions)));
  await bumpManagedCardRevisions(
    db,
    rows.map((row) => row.cardId),
  );
}

async function findMatchesInTx(
  db: Db,
  input: { userId: string; topicId: string; name: string; aliases: string[]; excludeId?: string },
): Promise<ConceptMatch[]> {
  const rows = await db
    .select({
      id: concepts.id,
      name: concepts.name,
      sense: concepts.sense,
      aliases: concepts.aliases,
    })
    .from(concepts)
    .where(
      and(
        eq(concepts.userId, input.userId),
        eq(concepts.topicId, input.topicId),
        isNull(concepts.archivedAt),
        ...(input.excludeId ? [ne(concepts.id, input.excludeId)] : []),
      ),
    );
  const matches: ConceptMatch[] = [];
  for (const row of rows) {
    const matchedBy = conceptMatchKind({ name: input.name, aliases: input.aliases }, row);
    if (matchedBy) {
      matches.push({ conceptId: row.id, name: row.name, sense: row.sense, matchedBy });
    }
    if (matches.length >= 5) break;
  }
  return matches;
}

export async function findConceptMatches(
  userId: string,
  topicId: string,
  input: { name: string; aliases: string[] },
): Promise<ConceptMatch[]> {
  await getOwnedTopic(userId, topicId);
  return findMatchesInTx(getDb(), { userId, topicId, name: input.name, aliases: input.aliases });
}

async function insertConceptRow(
  db: Db,
  input: {
    userId: string;
    topicId: string;
    name: string;
    aliases: string[];
    sense: string | null;
    definition: string | null;
    example: string | null;
    origin: 'manual' | 'agent';
  },
): Promise<ConceptRow> {
  const [row] = await db
    .insert(concepts)
    .values({
      userId: input.userId,
      topicId: input.topicId,
      name: input.name,
      normalizedName: normalizeConceptName(input.name),
      aliases: input.aliases,
      sense: input.sense,
      definition: input.definition,
      example: input.example,
      origin: input.origin,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return row;
}

/** 同用户同主题且未归档的概念；不存在/跨主题/已归档统一拒绝。 */
async function requireActiveEndpoint(
  db: Db,
  input: { userId: string; topicId: string; conceptId: string },
): Promise<ConceptRow> {
  const [row] = await db
    .select()
    .from(concepts)
    .where(
      and(
        eq(concepts.id, input.conceptId),
        eq(concepts.userId, input.userId),
        eq(concepts.topicId, input.topicId),
      ),
    )
    .limit(1);
  if (!row || row.archivedAt) throw AppError.of(422, 'CONCEPT_ENDPOINT_INVALID');
  return row;
}

/**
 * 插入或按身份去重关系。命中相同 identityHash 的有效关系时返回已有行
 * （created=false），由调用方补充证据；不同语境的关系并列保留。
 */
async function insertRelationRow(
  db: Db,
  input: {
    userId: string;
    topicId: string;
    fromConceptId: string;
    toConceptId: string;
    kind: CreateConceptRelationInput['kind'];
    predicate: string;
    context: string | null;
    explanation: string | null;
    example: string | null;
    origin: 'manual' | 'agent';
    basis: CreateConceptRelationInput['basis'];
  },
): Promise<{ row: ConceptRelationRow; created: boolean }> {
  if (input.fromConceptId === input.toConceptId) {
    throw AppError.of(422, 'CONCEPT_SELF_RELATION');
  }
  const identityHash = relationIdentityHash(input);
  const [existing] = await db
    .select()
    .from(conceptRelations)
    .where(
      and(
        eq(conceptRelations.userId, input.userId),
        eq(conceptRelations.identityHash, identityHash),
        isNull(conceptRelations.archivedAt),
      ),
    )
    .limit(1);
  if (existing) return { row: existing, created: false };
  const [row] = await db
    .insert(conceptRelations)
    .values({
      userId: input.userId,
      topicId: input.topicId,
      fromConceptId: input.fromConceptId,
      toConceptId: input.toConceptId,
      kind: input.kind,
      predicate: input.predicate,
      normalizedPredicate: normalizeConceptName(input.predicate),
      context: input.context,
      normalizedContext: normalizeConceptName(input.context ?? ''),
      explanation: input.explanation,
      example: input.example,
      origin: input.origin,
      basis: input.basis,
      identityHash,
    })
    .returning();
  if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
  return { row, created: true };
}

/** 本文引用 upsert：活跃引用不动；已移除引用在显式重新收录时复活。 */
export async function upsertDocumentKnowledgeRef(
  db: Db,
  input: {
    userId: string;
    topicId: string;
    documentId: string;
    target: { conceptId: string } | { relationId: string };
    origin: 'manual' | 'agent';
  },
): Promise<void> {
  const targetColumn =
    'conceptId' in input.target ? documentKnowledgeRefs.conceptId : documentKnowledgeRefs.relationId;
  const targetId = 'conceptId' in input.target ? input.target.conceptId : input.target.relationId;
  const [existing] = await db
    .select()
    .from(documentKnowledgeRefs)
    .where(and(eq(documentKnowledgeRefs.documentId, input.documentId), eq(targetColumn, targetId)))
    .limit(1);
  if (existing) {
    if (existing.removedAt) {
      await db
        .update(documentKnowledgeRefs)
        .set({ removedAt: null, origin: input.origin, updatedAt: new Date() })
        .where(eq(documentKnowledgeRefs.id, existing.id));
    }
    return;
  }
  await db.insert(documentKnowledgeRefs).values({
    userId: input.userId,
    topicId: input.topicId,
    documentId: input.documentId,
    conceptId: 'conceptId' in input.target ? input.target.conceptId : null,
    relationId: 'relationId' in input.target ? input.target.relationId : null,
    origin: input.origin,
  });
}

export async function createConcept(
  userId: string,
  topicId: string,
  rawInput: CreateConceptRawInput,
): Promise<CreateConceptResult> {
  // 服务边界再解析一次：保证数组默认值在绕过路由的调用（测试/内部）下也生效。
  const input = createConceptInputSchema.parse(rawInput);
  return getDb().transaction(async (tx) => {
    await lockActiveTopic(tx, userId, topicId);
    const row = await insertConceptRow(tx, {
      userId,
      topicId,
      name: input.name,
      aliases: input.aliases,
      sense: input.sense ?? null,
      definition: input.definition ?? null,
      example: input.example ?? null,
      origin: 'manual',
    });
    if (input.evidence.length > 0) {
      await insertEvidenceForTarget(tx, {
        userId,
        target: { conceptId: row.id },
        items: input.evidence,
      });
    }
    await bumpConceptGraphRevision(tx, topicId);
    const matches = await findMatchesInTx(tx, {
      userId,
      topicId,
      name: input.name,
      aliases: input.aliases,
      excludeId: row.id,
    });
    return { concept: toPublicConcept(row), matches };
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function listConcepts(
  userId: string,
  topicId: string,
  rawQuery: ListConceptsRawQuery,
): Promise<{ items: Concept[]; nextCursor: string | null }> {
  const query = listConceptsQuerySchema.parse(rawQuery);
  await getOwnedTopic(userId, topicId);
  const conditions: SQL[] = [eq(concepts.userId, userId), eq(concepts.topicId, topicId)];
  if (!query.includeArchived) conditions.push(isNull(concepts.archivedAt));
  if (query.q) {
    const pattern = `%${escapeLike(normalizeConceptName(query.q))}%`;
    conditions.push(
      sql`(${concepts.normalizedName} ILIKE ${pattern} ESCAPE '\\' OR EXISTS (SELECT 1 FROM unnest(${concepts.aliases}) AS alias_item WHERE alias_item ILIKE ${pattern} ESCAPE '\\'))`,
    );
  }
  if (query.cursor) {
    conditions.push(conceptKeysetAfter(query.cursor));
  }
  const db = getDb();
  const rows = await db
    .select()
    .from(concepts)
    .where(and(...conditions))
    .orderBy(asc(concepts.createdAt), asc(concepts.id))
    .limit(query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? encodeCursor({ c: await preciseCreatedAt(db, last.id), i: last.id })
      : null;
  return { items: page.map(toPublicConcept), nextCursor };
}

export async function getConcept(userId: string, id: string): Promise<ConceptDetail> {
  const row = await getOwnedConcept(userId, id);
  const relations = await getDb()
    .select()
    .from(conceptRelations)
    .where(
      and(
        eq(conceptRelations.topicId, row.topicId),
        isNull(conceptRelations.archivedAt),
        or(eq(conceptRelations.fromConceptId, id), eq(conceptRelations.toConceptId, id)),
      ),
    )
    .orderBy(asc(conceptRelations.id))
    .limit(101);
  const evidence = await getDb()
    .select()
    .from(conceptEvidence)
    .where(and(eq(conceptEvidence.conceptId, id), eq(conceptEvidence.userId, userId)))
    .orderBy(asc(conceptEvidence.createdAt), asc(conceptEvidence.id));
  return {
    concept: toPublicConcept(row),
    relations: relations.slice(0, 100).map(toPublicRelation),
    relationsNextCursor: relations.length > 100 ? relations[99]!.id : null,
    evidence: evidence.map(toPublicEvidence),
    practice: await getConceptPracticeSummary(getDb(), { userId, conceptId: id }),
  };
}

export async function updateConcept(
  userId: string,
  id: string,
  input: UpdateConceptInput,
): Promise<Concept> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, id), eq(concepts.userId, userId)))
      .for('update')
      .limit(1);
    if (!current) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    if (current.archivedAt) throw AppError.of(409, 'CONCEPT_ARCHIVED');
    await lockActiveTopic(tx, userId, current.topicId);
    if (current.version !== input.expectedVersion) {
      throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    }
    const semantic = conceptSemanticChanged(current, input);
    const now = new Date();
    const [row] = await tx
      .update(concepts)
      .set({
        ...(input.name !== undefined
          ? { name: input.name, normalizedName: normalizeConceptName(input.name) }
          : {}),
        ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
        ...(input.sense !== undefined ? { sense: input.sense } : {}),
        ...(input.definition !== undefined ? { definition: input.definition } : {}),
        ...(input.example !== undefined ? { example: input.example } : {}),
        ...(semantic ? { version: current.version + 1 } : {}),
        updatedAt: now,
      })
      .where(and(eq(concepts.id, id), eq(concepts.version, input.expectedVersion)))
      .returning();
    if (!row) throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    if (semantic) {
      const adjacent = await tx
        .update(conceptRelations)
        .set({ version: sql`${conceptRelations.version} + 1`, updatedAt: now })
        .where(
          and(
            eq(conceptRelations.topicId, current.topicId),
            isNull(conceptRelations.archivedAt),
            or(eq(conceptRelations.fromConceptId, id), eq(conceptRelations.toConceptId, id)),
          ),
        )
        .returning({ id: conceptRelations.id });
      await markPracticesStale(tx, {
        conceptIds: [id],
        relationIds: adjacent.map((relation) => relation.id),
      });
      await bumpConceptGraphRevision(tx, current.topicId);
    }
    return toPublicConcept(row);
  });
}

export async function archiveConcept(
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<ConceptArchiveResult> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, id), eq(concepts.userId, userId)))
      .for('update')
      .limit(1);
    if (!current) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    await lockActiveTopic(tx, userId, current.topicId);
    if (current.version !== expectedVersion) {
      throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    }
    const now = new Date();
    if (!current.archivedAt) {
      await tx.update(concepts).set({ archivedAt: now, updatedAt: now }).where(eq(concepts.id, id));
    }
    // 同事务归档相邻有效关系；恢复不自动恢复连带对象。
    const archived = await tx
      .update(conceptRelations)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(conceptRelations.topicId, current.topicId),
          isNull(conceptRelations.archivedAt),
          or(eq(conceptRelations.fromConceptId, id), eq(conceptRelations.toConceptId, id)),
        ),
      )
      .returning({ id: conceptRelations.id });
    const relationIds = archived.map((relation) => relation.id);
    const affectedPractices = await markPracticesResumeRequired(tx, {
      conceptIds: [id],
      relationIds,
    });
    await bumpConceptGraphRevision(tx, current.topicId);
    const [row] = await tx.select().from(concepts).where(eq(concepts.id, id)).limit(1);
    if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
    return {
      concept: toPublicConcept(row),
      archivedRelations: relationIds.length,
      affectedPractices,
    };
  });
}

export async function restoreConcept(
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<Concept> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(concepts)
      .where(and(eq(concepts.id, id), eq(concepts.userId, userId)))
      .for('update')
      .limit(1);
    if (!current) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    await lockActiveTopic(tx, userId, current.topicId);
    if (current.version !== expectedVersion) {
      throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    }
    const [row] = await tx
      .update(concepts)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(concepts.id, id))
      .returning();
    if (!row) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
    // 恢复同样轮换受影响卡片版本（不自动恢复练习，绑定仍需显式 resume）
    await rotateCardRevisionsForTargets(tx, { conceptIds: [id] });
    await bumpConceptGraphRevision(tx, current.topicId);
    return toPublicConcept(row);
  });
}

export async function createConceptRelation(
  userId: string,
  topicId: string,
  rawInput: CreateRelationRawInput,
): Promise<CreateConceptRelationResult> {
  const input = createConceptRelationInputSchema.parse(rawInput);
  return getDb().transaction(async (tx) => {
    await lockActiveTopic(tx, userId, topicId);
    await requireActiveEndpoint(tx, { userId, topicId, conceptId: input.fromConceptId });
    await requireActiveEndpoint(tx, { userId, topicId, conceptId: input.toConceptId });
    const { row, created } = await insertRelationRow(tx, {
      userId,
      topicId,
      fromConceptId: input.fromConceptId,
      toConceptId: input.toConceptId,
      kind: input.kind,
      predicate: input.predicate,
      context: input.context ?? null,
      explanation: input.explanation ?? null,
      example: input.example ?? null,
      origin: 'manual',
      basis: input.basis,
    });
    let evidenceAppended = 0;
    if (input.evidence.length > 0) {
      evidenceAppended = await insertEvidenceForTarget(tx, {
        userId,
        target: { relationId: row.id },
        items: input.evidence,
      });
    }
    if (created || evidenceAppended > 0) await bumpConceptGraphRevision(tx, topicId);
    return { relation: toPublicRelation(row), created, evidenceAppended };
  });
}

export async function getConceptRelation(
  userId: string,
  id: string,
): Promise<ConceptRelationDetail> {
  const row = await getOwnedRelation(userId, id);
  const [fromConcept] = await getDb()
    .select()
    .from(concepts)
    .where(and(eq(concepts.id, row.fromConceptId), eq(concepts.userId, userId)))
    .limit(1);
  const [toConcept] = await getDb()
    .select()
    .from(concepts)
    .where(and(eq(concepts.id, row.toConceptId), eq(concepts.userId, userId)))
    .limit(1);
  if (!fromConcept || !toConcept) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
  const evidence = await getDb()
    .select()
    .from(conceptEvidence)
    .where(and(eq(conceptEvidence.relationId, id), eq(conceptEvidence.userId, userId)))
    .orderBy(asc(conceptEvidence.createdAt), asc(conceptEvidence.id));
  return {
    relation: toPublicRelation(row),
    fromConcept: toPublicConcept(fromConcept),
    toConcept: toPublicConcept(toConcept),
    evidence: evidence.map(toPublicEvidence),
    practice: await getConceptPracticeSummary(getDb(), { userId, relationId: id }),
  };
}

export async function updateConceptRelation(
  userId: string,
  id: string,
  input: UpdateConceptRelationInput,
): Promise<ConceptRelation> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(conceptRelations)
      .where(and(eq(conceptRelations.id, id), eq(conceptRelations.userId, userId)))
      .for('update')
      .limit(1);
    if (!current) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    if (current.archivedAt) throw AppError.of(409, 'CONCEPT_RELATION_ARCHIVED');
    await lockActiveTopic(tx, userId, current.topicId);
    if (current.version !== input.expectedVersion) {
      throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    }
    const nextKind = input.kind ?? current.kind;
    const nextPredicate = input.predicate ?? current.predicate;
    const nextContext = input.context !== undefined ? input.context : current.context;
    const nextHash = relationIdentityHash({
      userId: current.userId,
      topicId: current.topicId,
      fromConceptId: current.fromConceptId,
      toConceptId: current.toConceptId,
      kind: nextKind,
      predicate: nextPredicate,
      context: nextContext,
    });
    if (nextHash !== current.identityHash) {
      const [conflict] = await tx
        .select({ id: conceptRelations.id })
        .from(conceptRelations)
        .where(
          and(
            eq(conceptRelations.userId, userId),
            eq(conceptRelations.identityHash, nextHash),
            isNull(conceptRelations.archivedAt),
            ne(conceptRelations.id, id),
          ),
        )
        .limit(1);
      if (conflict) throw AppError.of(409, 'CONCEPT_RELATION_DUPLICATE');
    }
    const semantic = relationSemanticChanged(current, input);
    const now = new Date();
    const [row] = await tx
      .update(conceptRelations)
      .set({
        ...(input.kind !== undefined ? { kind: input.kind } : {}),
        ...(input.predicate !== undefined
          ? { predicate: input.predicate, normalizedPredicate: normalizeConceptName(input.predicate) }
          : {}),
        ...(input.context !== undefined
          ? { context: input.context, normalizedContext: normalizeConceptName(input.context ?? '') }
          : {}),
        ...(input.explanation !== undefined ? { explanation: input.explanation } : {}),
        ...(input.example !== undefined ? { example: input.example } : {}),
        identityHash: nextHash,
        ...(semantic ? { version: current.version + 1 } : {}),
        updatedAt: now,
      })
      .where(and(eq(conceptRelations.id, id), eq(conceptRelations.version, input.expectedVersion)))
      .returning();
    if (!row) throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    if (semantic) {
      await markPracticesStale(tx, { relationIds: [id] });
      await bumpConceptGraphRevision(tx, current.topicId);
    }
    return toPublicRelation(row);
  });
}

export async function archiveConceptRelation(
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<RelationArchiveResult> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(conceptRelations)
      .where(and(eq(conceptRelations.id, id), eq(conceptRelations.userId, userId)))
      .for('update')
      .limit(1);
    if (!current) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    await lockActiveTopic(tx, userId, current.topicId);
    if (current.version !== expectedVersion) {
      throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    }
    const now = new Date();
    const [row] = await tx
      .update(conceptRelations)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(conceptRelations.id, id))
      .returning();
    if (!row) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    const affectedPractices = await markPracticesResumeRequired(tx, { relationIds: [id] });
    await bumpConceptGraphRevision(tx, current.topicId);
    return { relation: toPublicRelation(row), affectedPractices };
  });
}

export async function restoreConceptRelation(
  userId: string,
  id: string,
  expectedVersion: number,
): Promise<ConceptRelation> {
  return getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(conceptRelations)
      .where(and(eq(conceptRelations.id, id), eq(conceptRelations.userId, userId)))
      .for('update')
      .limit(1);
    if (!current) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    await lockActiveTopic(tx, userId, current.topicId);
    if (current.version !== expectedVersion) {
      throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
    }
    // 恢复关系要求两个端点均有效。
    await requireActiveEndpoint(tx, {
      userId,
      topicId: current.topicId,
      conceptId: current.fromConceptId,
    });
    await requireActiveEndpoint(tx, {
      userId,
      topicId: current.topicId,
      conceptId: current.toConceptId,
    });
    const [row] = await tx
      .update(conceptRelations)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(eq(conceptRelations.id, id))
      .returning();
    if (!row) throw AppError.of(404, 'CONCEPT_RELATION_NOT_FOUND');
    await rotateCardRevisionsForTargets(tx, { relationIds: [id] });
    await bumpConceptGraphRevision(tx, current.topicId);
    return toPublicRelation(row);
  });
}

/**
 * 一次原子保存概念及所选关系。同 requestId 同请求返回原结果，
 * 同 requestId 不同请求返回 409；幂等记录与业务写入同事务。
 */
export async function saveConceptBundle(
  userId: string,
  topicId: string,
  rawInput: SaveBundleRawInput,
): Promise<SaveConceptBundleResult> {
  const input = saveConceptBundleInputSchema.parse(rawInput);
  const requestHash = requestHashOf({ ...input, requestId: undefined });
  return getDb().transaction(async (tx) => {
    await lockActiveTopic(tx, userId, topicId);

    const [existingRequest] = await tx
      .select()
      .from(conceptOperationRequests)
      .where(
        and(
          eq(conceptOperationRequests.userId, userId),
          eq(conceptOperationRequests.operation, 'concept_bundle'),
          eq(conceptOperationRequests.requestId, input.requestId),
        ),
      )
      .limit(1);
    if (existingRequest) {
      if (existingRequest.requestHash !== requestHash) {
        throw AppError.of(409, 'CONCEPT_REQUEST_CONFLICT');
      }
      return existingRequest.responseJson as SaveConceptBundleResult;
    }

    const snapshots = new Map<string, ConceptSourceSnapshot>();
    let documentId: string | null = null;
    if (input.documentId) {
      const [document] = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, input.documentId),
            eq(documents.userId, userId),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      if (!document) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
      documentId = document.id;
    }

    // 主概念：新建或复用（复用只补充说明与证据，不覆盖主定义）。
    let mainConcept: ConceptRow;
    let conceptReused = false;
    const createdConcepts: ConceptRow[] = [];
    if (input.concept.kind === 'create') {
      mainConcept = await insertConceptRow(tx, {
        userId,
        topicId,
        name: input.concept.name,
        aliases: input.concept.aliases,
        sense: input.concept.sense ?? null,
        definition: input.concept.definition ?? null,
        example: input.concept.example ?? null,
        origin: 'manual',
      });
      createdConcepts.push(mainConcept);
      if (input.concept.evidence.length > 0) {
        await insertEvidenceForTarget(tx, {
          userId,
          target: { conceptId: mainConcept.id },
          items: input.concept.evidence,
          snapshots,
        });
      }
    } else {
      const [existing] = await tx
        .select()
        .from(concepts)
        .where(
          and(
            eq(concepts.id, input.concept.conceptId),
            eq(concepts.userId, userId),
            eq(concepts.topicId, topicId),
          ),
        )
        .for('update')
        .limit(1);
      if (!existing) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
      if (existing.archivedAt) throw AppError.of(409, 'CONCEPT_ARCHIVED');
      if (existing.version !== input.concept.expectedVersion) {
        throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
      }
      mainConcept = existing;
      conceptReused = true;
      if (input.concept.note) {
        await tx.insert(conceptNotes).values({
          userId,
          topicId,
          conceptId: existing.id,
          relationId: null,
          documentId,
          text: input.concept.note,
          basis: 'user',
          createdBy: 'manual',
        });
      }
      if (input.concept.evidence.length > 0) {
        await insertEvidenceForTarget(tx, {
          userId,
          target: { conceptId: existing.id },
          items: input.concept.evidence,
          snapshots,
        });
      }
    }

    // 关系：另一端可新建或指向已有概念；相同身份去重并补充证据。
    const relationResults: { relation: ConceptRelation; created: boolean }[] = [];
    for (const relation of input.relations) {
      let otherConcept: ConceptRow;
      if (relation.other.kind === 'create') {
        otherConcept = await insertConceptRow(tx, {
          userId,
          topicId,
          name: relation.other.name,
          aliases: relation.other.aliases,
          sense: relation.other.sense ?? null,
          definition: relation.other.definition ?? null,
          example: relation.other.example ?? null,
          origin: 'manual',
        });
        createdConcepts.push(otherConcept);
      } else {
        otherConcept = await requireActiveEndpoint(tx, {
          userId,
          topicId,
          conceptId: relation.other.conceptId,
        });
      }
      const fromId = relation.direction === 'outgoing' ? mainConcept.id : otherConcept.id;
      const toId = relation.direction === 'outgoing' ? otherConcept.id : mainConcept.id;
      const { row, created } = await insertRelationRow(tx, {
        userId,
        topicId,
        fromConceptId: fromId,
        toConceptId: toId,
        kind: relation.kind,
        predicate: relation.predicate,
        context: relation.context ?? null,
        explanation: relation.explanation ?? null,
        example: relation.example ?? null,
        origin: 'manual',
        basis: relation.basis,
      });
      if (relation.evidence.length > 0) {
        await insertEvidenceForTarget(tx, {
          userId,
          target: { relationId: row.id },
          items: relation.evidence as EvidenceWriteItem[],
          snapshots,
        });
      }
      relationResults.push({ relation: toPublicRelation(row), created });
    }

    // 本文引用（显式 documentId 才写；主题入口不写）。
    if (documentId) {
      await upsertDocumentKnowledgeRef(tx, {
        userId,
        topicId,
        documentId,
        target: { conceptId: mainConcept.id },
        origin: 'manual',
      });
      for (const concept of createdConcepts) {
        if (concept.id === mainConcept.id) continue;
        await upsertDocumentKnowledgeRef(tx, {
          userId,
          topicId,
          documentId,
          target: { conceptId: concept.id },
          origin: 'manual',
        });
      }
      for (const { relation } of relationResults) {
        await upsertDocumentKnowledgeRef(tx, {
          userId,
          topicId,
          documentId,
          target: { relationId: relation.id },
          origin: 'manual',
        });
      }
    }

    await bumpConceptGraphRevision(tx, topicId);

    const result: SaveConceptBundleResult = {
      concept: toPublicConcept(mainConcept),
      conceptReused,
      createdConcepts: createdConcepts.map(toPublicConcept),
      relations: relationResults,
    };
    await tx.insert(conceptOperationRequests).values({
      userId,
      operation: 'concept_bundle',
      requestId: input.requestId,
      requestHash,
      responseJson: result,
    });
    return result;
  });
}
