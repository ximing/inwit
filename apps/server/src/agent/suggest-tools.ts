import { Type } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { loadUnattributedPool, writeTopicSuggestion } from '../topics/suggest.js';
import { asToolError } from './tools.js';

function toolResult(text: string, details: unknown = null) {
  return { content: [{ type: 'text' as const, text }], details };
}

export interface SuggestSession {
  userId: string;
  wroteKey: string | null;
}

const emptySchema = Type.Object({});

export function readUnattributedPoolTool(
  session: SuggestSession,
): AgentTool<typeof emptySchema> {
  return {
    name: 'read_unattributed_pool',
    label: '读取未归属资料',
    description:
      '读取近 30 天未归属且已消化的资料（标题 + 卡片概念）、活跃主题、已有开主题建议。提议前必须先调用。',
    parameters: emptySchema,
    execute: async () => {
      try {
        const pool = await loadUnattributedPool(session.userId);
        const payload = {
          documentCount: pool.documents.length,
          documents: pool.documents,
          activeTopics: pool.activeTopics,
          existingSuggestions: pool.existingSuggestions.map((row) => ({
            key: row.key,
            title: row.title,
            status: row.status,
            documentIds: row.documentIds,
            dismissedAt: row.dismissedAt,
          })),
        };
        return toolResult(JSON.stringify(payload), payload);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export const writeTopicSuggestionSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  documentIds: Type.Array(Type.String({ minLength: 1, maxLength: 36 }), {
    minItems: 4,
    maxItems: 40,
  }),
  slug: Type.Optional(
    Type.String({ minLength: 2, maxLength: 80, pattern: '^[a-z][a-z0-9-]{1,78}$' }),
  ),
});

export function writeTopicSuggestionTool(
  session: SuggestSession,
): AgentTool<typeof writeTopicSuggestionSchema> {
  return {
    name: 'write_topic_suggestion',
    label: '写入开主题建议',
    description:
      '当 ≥4 条未归属资料聚成一类、且没有对应活跃主题时，写入一条建议。同一主题用稳定 slug。一次任务只调用一次。',
    parameters: writeTopicSuggestionSchema,
    execute: async (_id, params) => {
      if (session.wroteKey) {
        const payload = { ok: false, reason: 'already wrote a suggestion this run' };
        return toolResult(JSON.stringify(payload), payload);
      }
      try {
        const result = await writeTopicSuggestion({
          userId: session.userId,
          title: params.title,
          reason: params.reason,
          documentIds: params.documentIds,
          ...(params.slug ? { slug: params.slug } : {}),
        });
        if (result.ok) session.wroteKey = result.key;
        return toolResult(JSON.stringify(result), result);
      } catch (err) {
        asToolError(err);
      }
    },
  };
}

export function suggestTools(session: SuggestSession): AgentTool[] {
  return [readUnattributedPoolTool(session), writeTopicSuggestionTool(session)];
}
