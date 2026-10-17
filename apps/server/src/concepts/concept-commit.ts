import { commitConceptBatchInputSchema } from '@inwit/dto';
import type {
  ConceptCommitResult,
  ConceptDraftRef,
} from '@inwit/dto';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import { getDb, type Database } from '../db/index.js';
import {
  conceptBatches,
  conceptNotes,
  conceptRelations,
  concepts,
  documents,
  type ConceptRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import {
  blocksOfDocument,
  insertEvidenceForTarget,
  type ConceptSourceSnapshot,
} from './concept-evidence.js';
import { documentHashFromBlocks } from './concept-evidence-logic.js';
import {
  normalizeConceptName,
  relationIdentityHash,
  requestHashOf,
} from './concept-identity.js';
import {
  bumpConceptGraphRevision,
  lockActiveTopic,
  upsertDocumentKnowledgeRef,
} from './concept.service.js';

type Db = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/**
 * 候选确认事务：锁批次与主题行 → 核对状态/草稿版本/正文 hash/existing 版本 →
 * 解析临时 ID → 建概念/补充说明与证据 → 关系去重/补证据 → 写本文引用 →
 * 保存提交结果并置 committed。任一步失败整体回滚。
 */

function decisionMaps(input: z.output<typeof commitConceptBatchInputSchema>) {
  return {
    conceptDecisions: new Map(input.conceptDecisions.map((decision) => [decision.tempId, decision])),
    relationDecisions: new Map(input.relationDecisions.map((decision) => [decision.tempId, decision])),
  };
}

async function loadExistingConcept(
  db: Db,
  input: { userId: string; topicId: string; conceptId: string; expectedVersion: number },
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
    .for('update')
    .limit(1);
  if (!row) throw AppError.of(404, 'CONCEPT_NOT_FOUND');
  if (row.archivedAt) throw AppError.of(409, 'CONCEPT_ARCHIVED');
  if (row.version !== input.expectedVersion) {
    throw AppError.of(409, 'CONCEPT_VERSION_CONFLICT');
  }
  return row;
}

export async function commitConceptBatch(
  userId: string,
  batchId: string,
  rawInput: z.input<typeof commitConceptBatchInputSchema>,
): Promise<ConceptCommitResult> {
  const input = commitConceptBatchInputSchema.parse(rawInput);
  const requestHash = requestHashOf({
    expectedDraftRevision: input.expectedDraftRevision,
    conceptDecisions: input.conceptDecisions,
    relationDecisions: input.relationDecisions,
  });

  return getDb().transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(conceptBatches)
      .where(and(eq(conceptBatches.id, batchId), eq(conceptBatches.userId, userId)))
      .for('update')
      .limit(1);
    if (!batch) throw AppError.of(404, 'CONCEPT_BATCH_NOT_FOUND');

    // 幂等：已提交的同命令返回原结果，不同命令 409。
    if (batch.status === 'committed') {
      if (batch.commitRequestHash === requestHash && batch.commitResult) {
        return batch.commitResult;
      }
      throw AppError.of(409, 'CONCEPT_BATCH_ALREADY_COMMITTED');
    }
    if (batch.status !== 'ready') throw AppError.of(409, 'CONCEPT_BATCH_NOT_READY');
    if (batch.draftRevision !== input.expectedDraftRevision) {
      throw AppError.of(409, 'CONCEPT_BATCH_CONFLICT');
    }
    const draft = batch.draft;
    if (!draft) throw AppError.of(409, 'CONCEPT_BATCH_NOT_READY');

    await lockActiveTopic(tx, userId, batch.topicId);

    // 正文 hash 校验：来源不可用或正文变化拒绝旧提交，不覆盖更新内容。
    if (!batch.documentId) throw AppError.of(409, 'CONCEPT_BATCH_STALE');
    const [document] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, batch.documentId))
      .limit(1);
    if (!document || document.deletedAt) throw AppError.of(409, 'CONCEPT_BATCH_STALE');
    if (document.userId !== userId) throw AppError.of(404, 'DOCUMENT_NOT_FOUND');
    const blocks = blocksOfDocument(document);
    if (documentHashFromBlocks(blocks) !== batch.documentHash) {
      throw AppError.of(409, 'CONCEPT_BATCH_STALE');
    }

    const { conceptDecisions, relationDecisions } = decisionMaps(input);
    const draftConceptByTempId = new Map(draft.concepts.map((concept) => [concept.tempId, concept]));
    const draftRelationByTempId = new Map(draft.relations.map((relation) => [relation.tempId, relation]));
    for (const tempId of conceptDecisions.keys()) {
      if (!draftConceptByTempId.has(tempId)) {
        throw AppError.of(400, 'VALIDATION_ERROR', { tempId });
      }
    }
    for (const tempId of relationDecisions.keys()) {
      if (!draftRelationByTempId.has(tempId)) {
        throw AppError.of(400, 'VALIDATION_ERROR', { tempId });
      }
    }

    // 推断项必须显式确认。
    for (const decision of input.conceptDecisions) {
      const draftConcept = draftConceptByTempId.get(decision.tempId)!;
      if (
        decision.decision !== 'skip' &&
        draftConcept.basis === 'inferred' &&
        decision.acknowledged !== true
      ) {
        throw AppError.of(422, 'CONCEPT_INFERRED_UNCONFIRMED', { tempId: decision.tempId });
      }
    }
    for (const decision of input.relationDecisions) {
      const draftRelation = draftRelationByTempId.get(decision.tempId)!;
      if (
        decision.decision === 'create' &&
        draftRelation.basis === 'inferred' &&
        decision.acknowledged !== true
      ) {
        throw AppError.of(422, 'CONCEPT_INFERRED_UNCONFIRMED', { tempId: decision.tempId });
      }
    }

    const snapshots = new Map<string, ConceptSourceSnapshot>();
    const conceptIdMap: Record<string, string> = {};
    const relationIdMap: Record<string, string> = {};
    const conceptActions: Record<string, 'created' | 'reused' | 'skipped'> = {};
    const relationActions: Record<string, 'created' | 'supplemented' | 'skipped'> = {};
    const counts = {
      createdConcepts: 0,
      reusedConcepts: 0,
      createdRelations: 0,
      supplementedRelations: 0,
      appendedEvidence: 0,
    };
    /** 端点解析：候选 tempId → 新/复用概念；existing → 校验版本与归属。 */
    const resolvedConceptIds = new Map<string, string>();

    // 1) 概念决定：create / reuse / skip。未提及的候选视为 skip。
    for (const draftConcept of draft.concepts) {
      const decision = conceptDecisions.get(draftConcept.tempId);
      if (!decision || decision.decision === 'skip') {
        conceptActions[draftConcept.tempId] = 'skipped';
        continue;
      }
      if (decision.decision === 'create') {
        const overrides = decision.overrides ?? {};
        const name = overrides.name ?? draftConcept.name;
        const [row] = await tx
          .insert(concepts)
          .values({
            userId,
            topicId: batch.topicId,
            name,
            normalizedName: normalizeConceptName(name),
            aliases: overrides.aliases ?? draftConcept.aliases,
            sense: overrides.sense !== undefined ? overrides.sense : draftConcept.sense,
            definition:
              overrides.definition !== undefined ? overrides.definition : draftConcept.definition,
            example: overrides.example !== undefined ? overrides.example : draftConcept.example,
            origin: 'agent',
          })
          .returning();
        if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
        resolvedConceptIds.set(draftConcept.tempId, row.id);
        conceptIdMap[draftConcept.tempId] = row.id;
        conceptActions[draftConcept.tempId] = 'created';
        counts.createdConcepts += 1;
        counts.appendedEvidence += await insertEvidenceForTarget(tx, {
          userId,
          target: { conceptId: row.id },
          items: draftConcept.evidence.map((item) => ({
            documentId: item.documentId ?? batch.documentId!,
            locator: item.locator,
            basis: item.basis,
          })),
          snapshots,
        });
      } else {
        // reuse：默认仅追加证据与说明，不覆盖用户维护的主要定义。
        const existing = await loadExistingConcept(tx, {
          userId,
          topicId: batch.topicId,
          conceptId: decision.reuseConceptId!,
          expectedVersion: decision.reuseExpectedVersion!,
        });
        resolvedConceptIds.set(draftConcept.tempId, existing.id);
        conceptIdMap[draftConcept.tempId] = existing.id;
        conceptActions[draftConcept.tempId] = 'reused';
        counts.reusedConcepts += 1;
        if (decision.note) {
          await tx.insert(conceptNotes).values({
            userId,
            topicId: batch.topicId,
            conceptId: existing.id,
            relationId: null,
            documentId: batch.documentId,
            text: decision.note,
            basis: draftConcept.basis,
            createdBy: 'agent',
          });
        }
        counts.appendedEvidence += await insertEvidenceForTarget(tx, {
          userId,
          target: { conceptId: existing.id },
          items: draftConcept.evidence.map((item) => ({
            documentId: item.documentId ?? batch.documentId!,
            locator: item.locator,
            basis: item.basis,
          })),
          snapshots,
        });
      }
    }

    // 2) 关系决定：端点解析（含显式重绑定），悬空关系 422。
    const resolveRef = (ref: ConceptDraftRef, relationTempId: string): string => {
      if (ref.kind === 'candidate') {
        const resolved = resolvedConceptIds.get(ref.tempId);
        if (!resolved) {
          throw AppError.of(422, 'CONCEPT_DANGLING_RELATION', {
            relationTempId,
            conceptTempId: ref.tempId,
          });
        }
        return resolved;
      }
      return ref.conceptId;
    };

    for (const draftRelation of draft.relations) {
      const decision = relationDecisions.get(draftRelation.tempId);
      if (!decision || decision.decision === 'skip') {
        relationActions[draftRelation.tempId] = 'skipped';
        continue;
      }
      const fromRef = decision.fromRef ?? draftRelation.fromRef;
      const toRef = decision.toRef ?? draftRelation.toRef;
      // existing 端点：校验归属与版本（版本过期拒绝旧确认）。
      for (const ref of [fromRef, toRef]) {
        if (ref.kind === 'existing') {
          await loadExistingConcept(tx, {
            userId,
            topicId: batch.topicId,
            conceptId: ref.conceptId,
            expectedVersion: ref.version,
          });
        }
      }
      const fromConceptId = resolveRef(fromRef, draftRelation.tempId);
      const toConceptId = resolveRef(toRef, draftRelation.tempId);
      if (fromConceptId === toConceptId) throw AppError.of(422, 'CONCEPT_SELF_RELATION');

      const overrides = decision.overrides ?? {};
      const kind = overrides.kind ?? draftRelation.kind;
      const predicate = overrides.predicate ?? draftRelation.predicate;
      const context = overrides.context !== undefined ? overrides.context : draftRelation.context;
      const explanation =
        overrides.explanation !== undefined ? overrides.explanation : draftRelation.explanation;
      const example = overrides.example !== undefined ? overrides.example : draftRelation.example;
      const identityHash = relationIdentityHash({
        userId,
        topicId: batch.topicId,
        fromConceptId,
        toConceptId,
        kind,
        predicate,
        context,
      });
      const [existingRelation] = await tx
        .select()
        .from(conceptRelations)
        .where(
          and(
            eq(conceptRelations.userId, userId),
            eq(conceptRelations.identityHash, identityHash),
            isNull(conceptRelations.archivedAt),
          ),
        )
        .limit(1);
      let relationId: string;
      if (existingRelation) {
        relationId = existingRelation.id;
        relationActions[draftRelation.tempId] = 'supplemented';
        counts.supplementedRelations += 1;
      } else {
        const [row] = await tx
          .insert(conceptRelations)
          .values({
            userId,
            topicId: batch.topicId,
            fromConceptId,
            toConceptId,
            kind,
            predicate,
            normalizedPredicate: normalizeConceptName(predicate),
            context,
            normalizedContext: normalizeConceptName(context ?? ''),
            explanation,
            example,
            origin: 'agent',
            basis: draftRelation.basis,
            identityHash,
          })
          .returning();
        if (!row) throw AppError.of(500, 'INTERNAL_ERROR');
        relationId = row.id;
        relationActions[draftRelation.tempId] = 'created';
        counts.createdRelations += 1;
      }
      relationIdMap[draftRelation.tempId] = relationId;
      counts.appendedEvidence += await insertEvidenceForTarget(tx, {
        userId,
        target: { relationId },
        items: draftRelation.evidence.map((item) => ({
          documentId: item.documentId ?? batch.documentId!,
          locator: item.locator,
          basis: item.basis,
        })),
        snapshots,
      });
    }

    // 3) 本文引用：所有接受的目标同事务写入（证据不自动复活引用，提交即显式收录）。
    for (const conceptId of Object.values(conceptIdMap)) {
      await upsertDocumentKnowledgeRef(tx, {
        userId,
        topicId: batch.topicId,
        documentId: batch.documentId,
        target: { conceptId },
        origin: 'agent',
      });
    }
    for (const relationId of Object.values(relationIdMap)) {
      await upsertDocumentKnowledgeRef(tx, {
        userId,
        topicId: batch.topicId,
        documentId: batch.documentId,
        target: { relationId },
        origin: 'agent',
      });
    }

    if (Object.keys(conceptIdMap).length > 0 || Object.keys(relationIdMap).length > 0) {
      await bumpConceptGraphRevision(tx, batch.topicId);
    }

    const result: ConceptCommitResult = {
      conceptIdMap,
      relationIdMap,
      actions: { concepts: conceptActions, relations: relationActions },
      counts,
      committedAt: new Date().toISOString(),
    };
    await tx
      .update(conceptBatches)
      .set({
        status: 'committed',
        commitRequestHash: requestHash,
        commitResult: result,
        committedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conceptBatches.id, batch.id));
    return result;
  });
}
