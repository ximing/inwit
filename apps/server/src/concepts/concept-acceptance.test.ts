import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Context } from '@earendil-works/pi-ai';
import type { ConceptDraftRef } from '@inwit/dto';

vi.mock('../llm/pi.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../llm/pi.js')>();
  return {
    ...original,
    resolveModelFor: async () => fakeResolvedModel(currentScript),
  };
});

import {
  cardQuestions,
  cards,
  conceptEvidence,
  conceptNotes,
  conceptRelations,
  concepts,
  jobs,
  reviewLogs,
  reviewStates,
} from '../db/schema.js';
import { getDb } from '../db/index.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedDocument, seedTopic, seedUser } from '../testkit/fixtures.js';
import { fakeResolvedModel, lastToolResult, type FakeModelScript } from '../testkit/fake-model.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { processConceptExtract } from '../agent/concept-extract.js';
import { createConceptBatch, getConceptBatch, updateConceptDraft } from './concept-batch.service.js';
import { commitConceptBatch } from './concept-commit.js';
import { resolveConceptEvidence } from './concept-evidence.js';
import { createConceptPractice, getConceptPracticeSummary } from './concept-practice.service.js';
import { createConcept, createConceptRelation } from './concept.service.js';
import { getReviewToday, submitReviewFeedback } from '../review/review.service.js';

let currentScript: FakeModelScript = () => ({ text: '完成' });

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

const TASK_QUOTE = 'Task 是实验的基本单位。';
const TRIAL_QUOTE = 'Trial 是 Task 的一次执行。';
const STEP_QUOTE = 'Step 是 Trial 中的一步。';
const TASK_DEFINITION = '实验的基本单位';
const SECOND_QUOTE = 'Task 在复习计划里表示待办。';
const SECOND_DEFINITION = '复习计划里的待办';
const REUSE_NOTE = '第二篇把 Task 用作复习计划中的待办。';

/** 常规提取脚本：read → submit → 收尾；结构被拒时按同一分片重交。 */
function extractionScript(
  submitFor: (shardIndex: number, shardText: string) => Record<string, unknown>,
): FakeModelScript {
  let lastReadShard = 0;
  return (context: Context) => {
    const last = lastToolResult(context);
    if (!last) return { toolCalls: [{ name: 'read_next_shard', arguments: {} }] };
    if (last.name === 'read_next_shard') {
      const payload = last.payload as { done?: boolean; shardIndex?: number; text?: string };
      if (payload.done) return { text: '全部分片已处理' };
      lastReadShard = payload.shardIndex!;
      return {
        toolCalls: [
          {
            name: 'submit_shard_candidates',
            arguments: submitFor(payload.shardIndex!, payload.text ?? ''),
          },
        ],
      };
    }
    const submitPayload = last.payload as { ok?: boolean };
    if (last.name === 'submit_shard_candidates' && submitPayload.ok === false) {
      return {
        toolCalls: [
          {
            name: 'submit_shard_candidates',
            arguments: submitFor(lastReadShard, ''),
          },
        ],
      };
    }
    return { toolCalls: [{ name: 'read_next_shard', arguments: {} }] };
  };
}

async function runExtractToEnd(iso: IsolatedDb, jobId: string): Promise<void> {
  const [job] = await iso.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('job missing');
  await iso.db.update(jobs).set({ status: 'running' }).where(eq(jobs.id, jobId));
  await processConceptExtract(job);
}

function candidateTempId(ref: ConceptDraftRef): string | null {
  return ref.kind === 'candidate' ? ref.tempId : null;
}

async function countFormal(iso: IsolatedDb, userId: string) {
  const [conceptRows, relationRows, cardRows] = await Promise.all([
    iso.db.select({ id: concepts.id }).from(concepts).where(eq(concepts.userId, userId)),
    iso.db
      .select({ id: conceptRelations.id })
      .from(conceptRelations)
      .where(eq(conceptRelations.userId, userId)),
    iso.db.select({ id: cards.id }).from(cards).where(eq(cards.userId, userId)),
  ]);
  return {
    concepts: conceptRows.length,
    relations: relationRows.length,
    cards: cardRows.length,
  };
}

describeDb('概念全链路（隔离库）', () => {
  let iso: IsolatedDb;

  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });

  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('生成、改草稿、确认、复用、出处与三档复习', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const documentId = await seedDocument(iso.db, userId, {
      topicId,
      title: '实验记录',
      blocks: [TASK_QUOTE, `${TRIAL_QUOTE}${STEP_QUOTE}`],
    });
    const first = await createConceptBatch(userId, documentId, {
      topicId,
      scope: 'document',
      requestId: 'acc-batch-1',
    });

    currentScript = extractionScript((shardIndex) => ({
      shardIndex,
      concepts: [
        {
          tempId: 'task',
          name: 'Task',
          basis: 'explicit',
          definition: TASK_DEFINITION,
          evidence: [{ quote: TASK_QUOTE, blockIndex: 1 }],
        },
        {
          tempId: 'trial',
          name: 'Trial',
          basis: 'explicit',
          definition: 'Task 的一次执行',
          evidence: [{ quote: TRIAL_QUOTE, blockIndex: 2 }],
        },
        {
          tempId: 'step',
          name: 'Step',
          basis: 'explicit',
          definition: 'Trial 中的一步',
          evidence: [{ quote: STEP_QUOTE, blockIndex: 2 }],
        },
      ],
      relations: [
        {
          tempId: 'task-trial',
          from: { tempId: 'task' },
          to: { tempId: 'trial' },
          kind: 'composition',
          predicate: '包含',
          basis: 'explicit',
          evidence: [{ quote: TRIAL_QUOTE, blockIndex: 2 }],
        },
        {
          tempId: 'trial-step',
          from: { tempId: 'trial' },
          to: { tempId: 'step' },
          kind: 'composition',
          predicate: '包含',
          basis: 'explicit',
          evidence: [{ quote: STEP_QUOTE, blockIndex: 2 }],
        },
      ],
    }));
    await runExtractToEnd(iso, first.jobId);

    const ready = await getConceptBatch(userId, first.batchId);
    expect(ready.status).toBe('ready');
    expect(ready.draft?.concepts.map((concept) => concept.name).sort()).toEqual([
      'Step',
      'Task',
      'Trial',
    ]);
    expect(ready.draft?.relations).toHaveLength(2);
    expect(ready.draft?.relations.every((relation) => relation.predicate === '包含')).toBe(true);
    expect(await countFormal(iso, userId)).toEqual({ concepts: 0, relations: 0, cards: 0 });

    const draft = ready.draft!;
    const step = draft.concepts.find((concept) => concept.name === 'Step');
    expect(step).toBeDefined();
    const edited = {
      schemaVersion: draft.schemaVersion,
      concepts: draft.concepts.filter((concept) => concept.tempId !== step!.tempId),
      relations: draft.relations
        .filter(
          (relation) =>
            candidateTempId(relation.fromRef) !== step!.tempId &&
            candidateTempId(relation.toRef) !== step!.tempId,
        )
        .map((relation) => ({ ...relation, predicate: '由多次执行组成' })),
    };
    expect(edited.concepts.map((concept) => concept.name).sort()).toEqual(['Task', 'Trial']);
    expect(edited.relations).toHaveLength(1);

    const saved = await updateConceptDraft(userId, first.batchId, {
      expectedDraftRevision: ready.draftRevision,
      draft: edited,
    });
    expect(saved.draft?.relations[0]?.predicate).toBe('由多次执行组成');
    expect(await countFormal(iso, userId)).toEqual({ concepts: 0, relations: 0, cards: 0 });

    const committed = await commitConceptBatch(userId, first.batchId, {
      expectedDraftRevision: saved.draftRevision,
      conceptDecisions: saved.draft!.concepts.map((concept) => ({
        tempId: concept.tempId,
        decision: 'create' as const,
      })),
      relationDecisions: saved.draft!.relations.map((relation) => ({
        tempId: relation.tempId,
        decision: 'create' as const,
      })),
      requestId: 'acc-commit-1',
    });
    expect(committed.counts.createdConcepts).toBe(2);
    expect(committed.counts.createdRelations).toBe(1);
    expect(committed.counts.reusedConcepts).toBe(0);

    const conceptRows = await iso.db.select().from(concepts).where(eq(concepts.userId, userId));
    expect(conceptRows.map((row) => row.name).sort()).toEqual(['Task', 'Trial']);
    const task = conceptRows.find((row) => row.name === 'Task')!;
    const trial = conceptRows.find((row) => row.name === 'Trial')!;
    expect(task.definition).toBe(TASK_DEFINITION);
    const versionBeforeReuse = task.version;
    const relationRows = await iso.db
      .select()
      .from(conceptRelations)
      .where(eq(conceptRelations.userId, userId));
    expect(relationRows).toHaveLength(1);
    expect(relationRows[0]!.fromConceptId).toBe(task.id);
    expect(relationRows[0]!.toConceptId).toBe(trial.id);
    expect(relationRows[0]!.predicate).toBe('由多次执行组成');

    const document2Id = await seedDocument(iso.db, userId, {
      topicId,
      title: '复习计划',
      blocks: [SECOND_QUOTE],
    });
    const second = await createConceptBatch(userId, document2Id, {
      topicId,
      scope: 'document',
      requestId: 'acc-batch-2',
    });
    currentScript = extractionScript((shardIndex) => ({
      shardIndex,
      concepts: [
        {
          tempId: 'task',
          name: 'Task',
          basis: 'explicit',
          definition: SECOND_DEFINITION,
          evidence: [{ quote: SECOND_QUOTE, blockIndex: 1 }],
        },
      ],
      relations: [],
    }));
    await runExtractToEnd(iso, second.jobId);

    const ready2 = await getConceptBatch(userId, second.batchId);
    expect(ready2.status).toBe('ready');
    const secondTask = ready2.draft!.concepts.find((concept) => concept.name === 'Task');
    expect(secondTask).toBeDefined();
    expect(secondTask!.matchCandidates.map((match) => match.conceptId)).toContain(task.id);

    const reused = await commitConceptBatch(userId, second.batchId, {
      expectedDraftRevision: ready2.draftRevision,
      conceptDecisions: [
        {
          tempId: secondTask!.tempId,
          decision: 'reuse',
          reuseConceptId: task.id,
          reuseExpectedVersion: versionBeforeReuse,
          note: REUSE_NOTE,
        },
      ],
      relationDecisions: [],
      requestId: 'acc-commit-2',
    });
    expect(reused.counts.reusedConcepts).toBe(1);
    expect(reused.counts.createdConcepts).toBe(0);

    const [taskAfter] = await iso.db.select().from(concepts).where(eq(concepts.id, task.id));
    expect(taskAfter!.definition).toBe(TASK_DEFINITION);
    expect(taskAfter!.version).toBe(versionBeforeReuse);
    const notes = await iso.db
      .select()
      .from(conceptNotes)
      .where(eq(conceptNotes.conceptId, task.id));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toBe(REUSE_NOTE);
    expect(notes[0]!.documentId).toBe(document2Id);
    const stillTwo = await iso.db.select().from(concepts).where(eq(concepts.userId, userId));
    expect(stillTwo.map((row) => row.name).sort()).toEqual(['Task', 'Trial']);

    const evidenceRows = await iso.db
      .select()
      .from(conceptEvidence)
      .where(and(eq(conceptEvidence.userId, userId), eq(conceptEvidence.conceptId, task.id)));
    const firstEvidence = evidenceRows.find(
      (row) => row.quote === TASK_QUOTE && row.documentId === documentId,
    );
    expect(firstEvidence).toBeDefined();
    const resolved = await resolveConceptEvidence(userId, firstEvidence!.id);
    expect(resolved.status).toBe('resolved');
    expect(resolved.quote).toBe(TASK_QUOTE);

    const practice = await createConceptPractice(userId, {
      targetKind: 'relation',
      targetId: relationRows[0]!.id,
      expectedVersion: relationRows[0]!.version,
      exerciseKind: 'compare',
      question: 'Task 与 Trial 是什么关系？',
      answer: '由多次执行组成',
      requestId: 'acc-practice-1',
    });
    const [question] = await iso.db
      .select()
      .from(cardQuestions)
      .where(eq(cardQuestions.cardId, practice.cardId));
    expect(question!.type).toBe('compare');

    const grades = ['forgot', 'fuzzy', 'remembered'] as const;
    const [initialState] = await iso.db
      .select()
      .from(reviewStates)
      .where(eq(reviewStates.cardId, practice.cardId));
    const marks = [{ intervalDays: initialState!.intervalDays, ease: initialState!.ease }];
    const base = Date.now();
    for (let index = 0; index < grades.length; index += 1) {
      const now = new Date(base + index * 1000);
      // 新练习卡默认明天到期；每次反馈后又被推到未来，取令牌前拨回过去。
      await iso.db
        .update(reviewStates)
        .set({ dueAt: new Date(now.getTime() - 1000) })
        .where(eq(reviewStates.cardId, practice.cardId));
      const today = await getReviewToday(userId, now, 2);
      const item = today.items.find((entry) => entry.card.id === practice.cardId);
      expect(item?.card.id).toBe(practice.cardId);
      expect(item?.reviewToken).toBeTruthy();
      const submitted = await submitReviewFeedback(userId, practice.cardId, grades[index]!, now, {
        reviewToken: item!.reviewToken!,
        requestId: `acc-fb-${grades[index]!}`,
      });
      expect(submitted.reviewState.cardId).toBe(practice.cardId);
      expect(new Date(submitted.reviewState.dueAt).getTime()).toBeGreaterThan(now.getTime());
      marks.push({
        intervalDays: submitted.reviewState.intervalDays,
        ease: submitted.reviewState.ease,
      });
    }

    const logs = await iso.db
      .select()
      .from(reviewLogs)
      .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.cardId, practice.cardId)))
      .orderBy(asc(reviewLogs.reviewedAt));
    expect(logs).toHaveLength(3);
    expect(logs.map((log) => log.cardId)).toEqual([
      practice.cardId,
      practice.cardId,
      practice.cardId,
    ]);
    expect(logs.map((log) => log.feedback)).toEqual(['forgot', 'fuzzy', 'remembered']);
    for (let index = 1; index < marks.length; index += 1) {
      const previous = marks[index - 1]!;
      const current = marks[index]!;
      expect(
        current.intervalDays !== previous.intervalDays ||
          Math.abs(current.ease - previous.ease) > 1e-6,
      ).toBe(true);
    }

    const relationSummary = await getConceptPracticeSummary(getDb(), {
      userId,
      relationId: relationRows[0]!.id,
    });
    expect(relationSummary.feedbackCount).toBe(3);
    const conceptSummary = await getConceptPracticeSummary(getDb(), {
      userId,
      conceptId: task.id,
    });
    expect(conceptSummary.binding).toBeNull();
    expect(conceptSummary.feedbackCount).toBe(0);
  });

  it('无 AI：手写概念、关系与练习，不产生概念任务', async () => {
    const userId = await seedUser(iso.db);
    const topicId = await seedTopic(iso.db, userId);
    const concept = await createConcept(userId, topicId, {
      name: '手动概念',
      aliases: [],
      definition: '不经过提取',
      evidence: [],
    });
    // 关系必须有两个端点。
    const endpoint = await createConcept(userId, topicId, {
      name: '另一端点',
      aliases: [],
      evidence: [],
    });
    const relation = await createConceptRelation(userId, topicId, {
      fromConceptId: concept.concept.id,
      toConceptId: endpoint.concept.id,
      kind: 'composition',
      predicate: '包含',
      basis: 'user',
      evidence: [],
    });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: concept.concept.id,
      expectedVersion: concept.concept.version,
      exerciseKind: 'recall',
      question: '手动概念是什么？',
      answer: '不经过提取',
      requestId: 'manual-practice-1',
    });
    expect(relation.relation.id).toBeTruthy();

    const aiJobs = await iso.db
      .select()
      .from(jobs)
      .where(
        and(eq(jobs.userId, userId), inArray(jobs.type, ['concept_extract', 'concept_practice'])),
      );
    expect(aiJobs).toHaveLength(0);

    const now = new Date();
    await iso.db
      .update(reviewStates)
      .set({ dueAt: new Date(now.getTime() - 1000) })
      .where(eq(reviewStates.cardId, practice.cardId));
    const today = await getReviewToday(userId, now, 2);
    const item = today.items.find((entry) => entry.card.id === practice.cardId);
    expect(item?.reviewToken).toBeTruthy();
    const submitted = await submitReviewFeedback(userId, practice.cardId, 'remembered', now, {
      reviewToken: item!.reviewToken!,
      requestId: 'manual-fb-remembered',
    });
    expect(submitted.log.feedback).toBe('remembered');
    expect(submitted.reviewState.cardId).toBe(practice.cardId);
  });
});
