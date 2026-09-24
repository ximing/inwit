import type { Job } from '@inwit/dto';
import { titleFromDoc } from '@inwit/dto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, jobs } from '../db/schema.js';
import { markdownToContentJson } from '../documents/content-json.js';
import { AppError } from '../errors.js';
import { enqueueJob } from '../jobs/queue.js';
import { toPublicJob } from '../jobs/jobs.service.js';
import { getOwnedTopic } from '../topics/topic.service.js';
import { fillStubMarkdown } from './fill-stub-logic.js';
import { nodeHasProposedCards, requireWritableMapNode } from './map.service.js';

async function assertWritableTopic(userId: string, topicId: string): Promise<void> {
  const topic = await getOwnedTopic(userId, topicId);
  if (topic.status === 'archived') throw AppError.of(409, 'TOPIC_ARCHIVED');
}

export async function findActiveTopicJob(userId: string, topicId: string): Promise<Job | null> {
  const [row] = await getDb()
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, userId),
        eq(jobs.type, 'topic'),
        inArray(jobs.status, ['pending', 'running']),
        sql`${jobs.payload}->>'topicId' = ${topicId}`,
      ),
    )
    .limit(1);
  return row ? toPublicJob(row) : null;
}

export async function enqueueOrganizeMapJob(userId: string, topicId: string): Promise<Job> {
  await assertWritableTopic(userId, topicId);
  const existing = await findActiveTopicJob(userId, topicId);
  if (existing) throw AppError.of(409, 'TOPIC_JOB_IN_PROGRESS', { jobId: existing.id });

  const row = await enqueueJob(getDb(), {
    userId,
    type: 'topic',
    payload: { topicId, action: 'organize' },
  });
  return toPublicJob(row);
}

export async function enqueueFillMapNodeJob(userId: string, nodeId: string): Promise<Job> {
  const node = await requireWritableMapNode(userId, nodeId);
  const existing = await findActiveTopicJob(userId, node.topicId);
  if (existing) throw AppError.of(409, 'TOPIC_JOB_IN_PROGRESS', { jobId: existing.id });
  if (await nodeHasProposedCards(userId, node.id)) {
    throw AppError.of(409, 'NODE_HAS_PROPOSED_CARDS');
  }

  const contentJson = markdownToContentJson(fillStubMarkdown(node.title));
  const title = titleFromDoc(contentJson);

  return getDb().transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        userId,
        topicId: node.topicId,
        mapNodeId: node.id,
        title,
        contentJson,
        source: 'editor',
        status: 'pending',
      })
      .returning();
    if (!document) throw AppError.of(500, 'INTERNAL_ERROR');
    const row = await enqueueJob(tx, {
      userId,
      type: 'topic',
      payload: {
        topicId: node.topicId,
        action: 'fill',
        nodeId: node.id,
        documentId: document.id,
      },
    });
    return toPublicJob(row);
  });
}
