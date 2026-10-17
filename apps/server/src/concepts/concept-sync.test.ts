import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncChanges } from '../db/schema.js';
import { isolatedDbContext, setupIsolatedDb, teardownIsolatedDb } from '../testkit/context.js';
import { seedTopic, seedUser } from '../testkit/fixtures.js';
import type { IsolatedDb } from '../testkit/isolated-db.js';
import { createConcept, updateConcept } from './concept.service.js';
import { createConceptPractice } from './concept-practice.service.js';

const dbCtx = isolatedDbContext();
const describeDb = describe.skipIf(!dbCtx.available);

describeDb('concept sync 触发器（真实 PG）', () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await setupIsolatedDb();
  });
  afterAll(async () => {
    await teardownIsolatedDb(iso);
  });

  it('概念与练习变更写入 sync_changes（scope=concept；绑定另发 review）', async () => {
    const db = iso.db;
    const userId = await seedUser(db);
    const topicId = await seedTopic(db, userId);

    const created = await createConcept(userId, topicId, {
      name: 'Task',
      aliases: [],
      evidence: [],
    });
    await updateConcept(userId, created.concept.id, {
      expectedVersion: 1,
      definition: '实验中的任务',
    });
    const practice = await createConceptPractice(userId, {
      targetKind: 'concept',
      targetId: created.concept.id,
      expectedVersion: 2,
      exerciseKind: 'recall',
      question: '什么是 Task？',
      answer: '实验任务',
      requestId: 'sync-1',
    });

    const rows = await db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.userId, userId));
    const conceptEvents = rows.filter((row) => row.scope === 'concept');
    expect(conceptEvents.length).toBeGreaterThanOrEqual(3); // 建概念 + 改定义 + 建绑定/卡片
    expect(conceptEvents.some((row) => row.resourceId === topicId)).toBe(true);

    // 练习绑定同时发 review 事件（复习页失效）
    const reviewEvents = rows.filter((row) => row.scope === 'review' && row.resourceId === practice.cardId);
    expect(reviewEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('其他用户的变更不进入本用户 sync 流', async () => {
    const db = iso.db;
    const userA = await seedUser(db);
    const userB = await seedUser(db);
    const topicA = await seedTopic(db, userA);
    await createConcept(userA, topicA, { name: '私有概念', aliases: [], evidence: [] });
    const rows = await db
      .select()
      .from(syncChanges)
      .where(eq(syncChanges.userId, userB));
    expect(rows.filter((row) => row.scope === 'concept')).toHaveLength(0);
  });
});
