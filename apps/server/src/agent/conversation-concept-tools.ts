import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, topics } from '../db/schema.js';
import { AppError } from '../errors.js';
import { createConceptBatch } from '../concepts/concept-batch.service.js';
import { conceptsWritable } from '../concepts/concepts-flag.js';
import { sha256Hex } from '../concepts/concept-identity.js';
import type { ConversationSession } from './conversation-tools.js';

function toolResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    details: payload as Record<string, unknown> | null,
  };
}

const proposeSchema = Type.Object({
  /** 要梳理的文章。省略时使用本轮 @ 的文章（恰好一篇时）。 */
  documentId: Type.Optional(Type.String({ maxLength: 36 })),
  /** 目标主题。省略时使用文章所属主题；文章没有主题时必须由用户选择。 */
  topicId: Type.Optional(Type.String({ maxLength: 36})),
});

/**
 * propose_article_concepts：为文章排队概念/关系候选生成（concept_extract）。
 * 只生成可审阅的批次，不收录任何正式知识；确认走批次 commit 接口（M1）。
 * 同一对话轮次内重复调用幂等返回同一批次。
 */
export function proposeArticleConceptsTool(
  session: ConversationSession,
): AgentTool<typeof proposeSchema> {
  return {
    name: 'propose_article_concepts',
    label: '生成概念与关系候选',
    description:
      '为当前文章生成概念与关系候选（后台任务）。只生成候选，不会收录或修改任何已有内容；候选生成后由用户在文章里核对并确认收录。文章不在任何主题时，返回已有主题列表，请用户先选择一个主题，不要自己新建主题。',
    parameters: proposeSchema,
    execute: async (_id, params) => {
      if (!conceptsWritable()) {
        return toolResult({ ok: false, code: 'disabled', reason: '概念功能尚未开放' });
      }

      // 当前文章：显式指定优先（重新鉴权），否则用本轮 @ 的唯一文章。
      let documentId = params.documentId ?? null;
      if (!documentId) {
        const mentioned = [...session.mentionDocumentIds];
        if (mentioned.length === 1) {
          documentId = mentioned[0]!;
        } else if (mentioned.length === 0) {
          return toolResult({
            ok: false,
            code: 'need_document',
            reason: '请让用户在消息里 @ 要梳理的文章，再试一次',
          });
        } else {
          return toolResult({
            ok: false,
            code: 'need_document',
            reason: '本轮 @ 了多篇文章，请用户明确要梳理哪一篇',
          });
        }
      }

      const [document] = await getDb()
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, documentId),
            eq(documents.userId, session.userId),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      if (!document) {
        return toolResult({ ok: false, code: 'not_found', reason: '找不到这篇文章或没有权限' });
      }

      let topicId = params.topicId ?? document.topicId;
      if (topicId) {
        const [topic] = await getDb()
          .select()
          .from(topics)
          .where(and(eq(topics.id, topicId), eq(topics.userId, session.userId)))
          .limit(1);
        if (!topic) {
          return toolResult({ ok: false, code: 'not_found', reason: '找不到这个主题或没有权限' });
        }
        if (topic.status === 'archived') {
          return toolResult({ ok: false, code: 'topic_archived', reason: '主题已归档，请先恢复再生成' });
        }
      } else {
        const choices = await getDb()
          .select({ id: topics.id, title: topics.title })
          .from(topics)
          .where(and(eq(topics.userId, session.userId), eq(topics.status, 'active')))
          .orderBy(asc(topics.updatedAt))
          .limit(20);
        return toolResult({
          ok: false,
          code: 'need_topic',
          reason: '这篇文章还没有主题。请用户从已有主题中选择一个，或先手动新建主题；不要自己创建主题。',
          topics: choices,
        });
      }

      const requestId = `conv-${sha256Hex(`${session.runKey}:${documentId}:${topicId}`).slice(0, 32)}`;
      try {
        const result = await createConceptBatch(session.userId, documentId, {
          topicId,
          scope: 'document',
          requestId,
        });
        session.actions.push({
          type: 'concept_batch',
          documentId,
          title: document.title ?? '未命名文档',
          topicId,
          batchId: result.batchId,
          jobId: result.jobId,
          status: 'queued',
        });
        return toolResult({
          ok: true,
          batchId: result.batchId,
          jobId: result.jobId,
          status: 'queued',
          note: '候选正在后台生成。生成只是候选，用户核对后才会收录；不要声称已经收录。',
        });
      } catch (err) {
        if (err instanceof AppError) {
          return toolResult({ ok: false, code: err.code, reason: err.message });
        }
        throw err;
      }
    },
  };
}
