import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { conversationJobPayloadSchema } from '@inwit/dto';
import type { JobRow } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  completeConversationMessage,
  loadConversationRun,
  patchConversationDraft,
} from '../conversations/conversation.service.js';
import { wantsCards, buildConversationPrompt, fallbackReply } from './conversation-logic.js';
import {
  applyConversationStream,
  conversationStreamView,
  emptyConversationStream,
  readAssistantPieces,
  type ConversationStreamState,
  type ConversationStreamView,
} from './conversation-stream-logic.js';
import { conversationTools, type ConversationSession } from './conversation-tools.js';
import { extractAssistantText, isAssistantMessage } from './messages.js';
import { runAgentJob } from './run-agent-job.js';

const DRAFT_FLUSH_MS = 150;

function streamEventOf(event: AgentEvent): Parameters<typeof applyConversationStream>[1] | null {
  if (event.type === 'message_update') {
    const inner = event.assistantMessageEvent;
    if (inner.type === 'text_delta') return { type: 'text_delta', delta: inner.delta };
    if (inner.type === 'thinking_delta') return { type: 'thinking_delta', delta: inner.delta };
    return null;
  }
  if (event.type === 'message_end' && isAssistantMessage(event.message)) {
    return { type: 'message_end', ...readAssistantPieces(event.message) };
  }
  if (event.type === 'tool_execution_start') return { type: 'tool_start', toolName: event.toolName };
  if (event.type === 'tool_execution_end') return { type: 'tool_end' };
  return null;
}

function createDraftSink(
  write: (view: ConversationStreamView) => Promise<void>,
): {
  push(event: AgentEvent): void;
  finish(): Promise<ConversationStreamView>;
} {
  let state: ConversationStreamState = emptyConversationStream();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain = Promise.resolve();
  let dirty = false;

  const enqueue = () => {
    dirty = false;
    const view = conversationStreamView(state);
    chain = chain.then(() => write(view)).catch((err: unknown) => {
      logger.warn('conversation.draft_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  return {
    push(event) {
      const next = streamEventOf(event);
      if (!next) return;
      state = applyConversationStream(state, next);
      dirty = true;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        enqueue();
      }, DRAFT_FLUSH_MS);
      timer.unref?.();
    },
    async finish() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (dirty) enqueue();
      await chain;
      return conversationStreamView(state);
    },
  };
}

export const CONVERSATION_SYSTEM_PROMPT = `你是 Inwit 的对话助手。用户在侧栏里和你多轮交谈，可以 @ 文档，也可以让你修改文档或新写一篇。

你可以：
- 用中文直接回答。回答写在消息正文里，适合学习，不要写成 JSON。
- 用 read_document 阅读文档。优先读本轮 @ 到的文档；需要别的文档时先 find_documents，再读属于用户的那一篇。
- 回答前可以检索用户已有的卡片和记忆，避免把已经学过的内容再讲一遍。
- 用户明确要求修改某篇已有文档时，调用 update_document，传入修改后的完整 Markdown 正文。只改用户指定的部分，其余内容保持原意。
- 用户要新写一篇、且没有指定要改的文档时，调用 create_document。
- 只有用户明确说要做成卡片、切卡或生成卡片时，才调用 write_cards。不要主动切卡，改完正文也不要再消化。

约束：
- 有未保存修改的文档，update_document 会被拒绝。遇到拒绝就说明原因，不要换一篇偷偷改。
- 不要删除或归档文档，不要改复习计划、主题地图或设置。
- 不知道就说不知道，不要编造文档内容。`;

export async function processConversation(job: JobRow): Promise<void> {
  const parsed = conversationJobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new Error('conversation job payload invalid');
  const { conversationId, assistantMessageId, dirtyDocumentIds, llmConfigId } = parsed.data;
  const run = await loadConversationRun(job.userId, conversationId, assistantMessageId);
  if (!run) {
    logger.info('conversation.skip', { jobId: job.id, conversationId, assistantMessageId });
    return;
  }

  const session: ConversationSession = {
    userId: job.userId,
    dirtyDocumentIds: new Set(dirtyDocumentIds),
    allowCards: wantsCards(run.latest),
    actions: [],
    writtenCardIds: [],
  };

  const draft = createDraftSink((view) =>
    patchConversationDraft({
      userId: job.userId,
      conversationId,
      messageId: assistantMessageId,
      content: view.content,
      thinking: view.thinking,
      activity: view.activity,
    }),
  );

  await runAgentJob({
    job,
    agentType: 'conversation',
    systemPrompt: CONVERSATION_SYSTEM_PROMPT,
    userPrompt: buildConversationPrompt({
      mentions: run.mentions,
      dirtyDocumentIds,
      allowCards: session.allowCards,
      earlier: run.earlier,
      latest: run.latest,
    }),
    tools: conversationTools(session),
    maxTurns: 12,
    onEvent: (event) => draft.push(event),
    verify: async ({ agent }) => {
      const view = await draft.finish();
      const text = extractAssistantText(agent.state.messages);
      const reply = text || fallbackReply(session.actions);
      if (!reply) throw new Error('回答是空的');
      await completeConversationMessage({
        userId: job.userId,
        conversationId,
        messageId: assistantMessageId,
        content: reply,
        thinking: view.thinking,
        actions: session.actions,
      });
      return `actions=${String(session.actions.length)}`;
    },
    nudgePrompt: '请用中文直接告诉用户结果。如果已经改过文档，说明改了哪一篇。',
    ...(llmConfigId ? { llmConfigId } : {}),
  });
}
