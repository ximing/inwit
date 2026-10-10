import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { conversationJobPayloadSchema } from '@inwit/dto';
import type { JobRow } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  completeConversationMessage,
  loadConversationRun,
  patchConversationDraft,
} from '../conversations/conversation.service.js';
import {
  wantsCards,
  buildConversationPrompt,
  fallbackReply,
  mindDocumentIds,
  mindNodeKey,
} from './conversation-logic.js';
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
- 用户可以把脑图节点加入对话。本轮带全文，之前加入的节点在对话里留着 id。讲解直接写在正文里。用户要求修改节点文字时调用 update_mind_node；这轮没有正文就先 read_mind_node。
- 用户要求在文档脑图里拆章节、建文章脉络，或把卡片归进脉络时：先 read_document 读正文。返回 truncated 时，用 fromBlock 跳到 unreadPages 里要划线的那一页，不要逐页读完整篇。然后再 read_document_mind 读当前脑图，用 apply_mind_edits 提交一批修改。能点回原文的脉络用 create_highlight。只能改本轮 @ 的文档，或本轮加入对话的节点所属的文档。

约束：
- 有未保存修改的文档，update_document 会被拒绝。遇到拒绝就说明原因，不要换一篇偷偷改。
- update_mind_node 只改用户加入过对话的节点的文字。卡片改概念，detail 才改例子；批注只改笔记，引文不动；文本节点改文字。图片不能改。不要改题目，不要用它删除节点。
- 要点回原文的脉络用 create_highlight，不要用没有锚点的文本节点冒充，也不要说自己不能划线。blockIndex 是 read_document 里「[块 N | …]」的 N。quote 必须是这一块里连续的原文，逐字抄写，不要改写，不要跨块。note 是脑图上显示的短标题，可以省略。原文对不上时整批不会写入。前文里只是提到后一章的句子，以及 unreadPages 里的开头一句，都不能当那一章的引文。PDF 上的框选划线仍只能由用户选中。
- 已有划线锚错位置时，用 retarget_highlight 改 blockIndex 和 quote，note 可选。节点 id 不变，父子关系不变。原文对不上时整批不会写入。
- 用户只要标题、不要求点回原文时，用 create_text。用户说把卡片归进脉络时，只 move 还没有父节点的卡片。已经有父节点的留着。对不上的卡片留在最外层。没有卡片的章节保留。
- 用户明确要求重排、改标题或删掉某章时，才 move 已有父子、rename_text、delete_text。delete_text 只删文本章节，子节点回到最外层，不删卡片和划线。
- 已有的批注和图片，默认不要移动。用户点名要挪时才 move。apply_mind_edits 不改卡片正文，也不要为此调用 write_cards。
- 同一批里先写父节点，再用 parentRef 挂到本批更早的 ref 上。已有节点用 id。挂到最外层时 parentId 为 null。最外层已有卡片时，新节点用 index 0、1、2 排在前面。没点名的节点不要写进 edits。
- 这轮没有点名的文档，不要读或改它的脑图，请用户 @ 那一篇。
- 脑图修改会留下版本。用户可以在脑图的编辑历史里恢复，不要为了回滚去重写整棵树。
- 不要删除或归档文档，不要改复习计划、主题里的知识地图或设置。
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

  const mindNodeKeys = new Set<string>();
  for (const message of run.earlier) {
    for (const node of message.nodes) {
      mindNodeKeys.add(mindNodeKey(node.documentId, node.nodeId));
    }
  }
  for (const node of run.nodes) {
    mindNodeKeys.add(mindNodeKey(node.documentId, node.nodeId));
  }

  const session: ConversationSession = {
    userId: job.userId,
    dirtyDocumentIds: new Set(dirtyDocumentIds),
    mindNodeKeys,
    mindDocumentIds: new Set(mindDocumentIds(run.mentions, run.nodes)),
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
      nodes: run.nodes,
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
