import { blocksFromPmJSON, type PmJson } from '@inwit/doc-schema';
import { eq } from 'drizzle-orm';
import type { ConceptDraft } from '@inwit/dto';
import type { Database } from '../db/index.js';
import { cardQuestions, cards, conceptBatches, documents, reviewStates, topics, users } from '../db/schema.js';
import { documentHashFromBlocks, totalCharsOfBlocks } from '../concepts/concept-evidence-logic.js';

/** 真实 PG 测试的种子辅助：每个文件 seed 独立用户，避免共享 schema 下相互干扰。 */

export async function seedUser(db: Database, emailSuffix?: string): Promise<string> {
  const suffix = emailSuffix ?? Math.random().toString(36).slice(2, 10);
  const [row] = await db
    .insert(users)
    .values({
      email: `m1-${suffix}@test.local`,
      passwordHash: 'x'.repeat(60),
      displayName: 'M1 测试',
    })
    .returning({ id: users.id });
  if (!row) throw new Error('seedUser failed');
  return row.id;
}

export async function seedTopic(
  db: Database,
  userId: string,
  overrides: { title?: string; status?: 'active' | 'archived' } = {},
): Promise<string> {
  const [row] = await db
    .insert(topics)
    .values({
      userId,
      title: overrides.title ?? '测试主题',
      ...(overrides.status ? { status: overrides.status } : {}),
    })
    .returning({ id: topics.id });
  if (!row) throw new Error('seedTopic failed');
  return row.id;
}

export interface SeedDocumentInput {
  title?: string | null;
  topicId?: string | null;
  /** 每个元素一个正文块；元素为 null 表示一个 pageBreak。 */
  blocks?: (string | null)[];
  fileMime?: string | null;
  fileKey?: string | null;
  deletedAt?: Date | null;
  status?: 'pending' | 'digested' | 'failed';
}

export function contentJsonFromBlocks(blocks: (string | null)[]): Record<string, unknown> {
  let pageBreaks = 0;
  const content = blocks.map((block) => {
    if (block === null) {
      pageBreaks += 1;
      return { type: 'pageBreak', attrs: { pageIndex: pageBreaks } };
    }
    return {
      type: 'paragraph',
      content: [{ type: 'text', text: block }],
    };
  });
  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

export async function seedDocument(
  db: Database,
  userId: string,
  input: SeedDocumentInput = {},
): Promise<string> {
  const [row] = await db
    .insert(documents)
    .values({
      userId,
      title: input.title === undefined ? '测试文档' : input.title,
      topicId: input.topicId ?? null,
      contentJson: contentJsonFromBlocks(input.blocks ?? ['第一段正文。', '第二段正文。']),
      source: 'editor',
      status: input.status ?? 'digested',
      fileMime: input.fileMime ?? null,
      fileKey: input.fileKey ?? null,
      deletedAt: input.deletedAt ?? null,
    })
    .returning({ id: documents.id });
  if (!row) throw new Error('seedDocument failed');
  return row.id;
}

export async function seedCard(
  db: Database,
  userId: string,
  input: { documentId?: string | null; topicId?: string | null; concept?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(cards)
    .values({
      userId,
      documentId: input.documentId ?? null,
      topicId: input.topicId ?? null,
      concept: input.concept ?? '测试概念',
      example: '例子',
      confusionPoint: '',
      source: 'manual',
    })
    .returning({ id: cards.id });
  if (!row) throw new Error('seedCard failed');
  return row.id;
}

/**
 * M1 测试夹具：直接插入一条 ready 状态的候选批次（生产不提供设置 ready 的接口；
 * M2 的 concept_extract processor 才是正常生成路径）。
 */
export async function seedReadyConceptBatch(
  db: Database,
  input: {
    userId: string;
    topicId: string;
    documentId: string;
    draft: ConceptDraft;
    status?: 'queued' | 'running' | 'ready' | 'committed';
  },
): Promise<string> {
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document) throw new Error('seedReadyConceptBatch: document missing');
  const blocks = blocksFromPmJSON(document.contentJson as PmJson);
  const hash = documentHashFromBlocks(blocks);
  const [row] = await db
    .insert(conceptBatches)
    .values({
      userId: input.userId,
      topicId: input.topicId,
      documentId: input.documentId,
      documentHash: hash,
      status: input.status ?? 'ready',
      draft: input.draft,
      coverage: { totalChars: 0, blocks: [] },
      contentSnapshot: {
        hash,
        totalChars: totalCharsOfBlocks(blocks.filter((block) => block.text.trim() !== '')),
        blocks: blocks.map((block) => ({
          index: block.index,
          pageIndex: block.pageIndex,
          text: block.text,
        })),
      },
    })
    .returning({ id: conceptBatches.id });
  if (!row) throw new Error('seedReadyConceptBatch failed');
  return row.id;
}

export async function seedCardQuestion(
  db: Database,
  cardId: string,
  input: { type?: 'cloze' | 'compare' | 'judge'; question?: string; answer?: string; createdAt?: Date } = {},
): Promise<string> {
  const [row] = await db
    .insert(cardQuestions)
    .values({
      cardId,
      type: input.type ?? 'cloze',
      question: input.question ?? '问题？',
      answer: input.answer ?? '答案。',
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning({ id: cardQuestions.id });
  if (!row) throw new Error('seedCardQuestion failed');
  return row.id;
}

export async function seedReviewState(
  db: Database,
  userId: string,
  cardId: string,
  input: { dueAt?: Date; reps?: number; ease?: number; intervalDays?: number; suspendedAt?: Date | null } = {},
): Promise<void> {
  await db.insert(reviewStates).values({
    userId,
    cardId,
    ease: input.ease ?? 2.5,
    intervalDays: input.intervalDays ?? 0,
    reps: input.reps ?? 0,
    dueAt: input.dueAt ?? new Date(Date.now() + 24 * 3600 * 1000),
    suspendedAt: input.suspendedAt ?? null,
  });
}
