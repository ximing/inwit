import type {
  Conversation,
  ConversationAction,
  ConversationDetail,
  ConversationDocumentRef,
  ConversationMessage,
  RetryConversationInput,
  SendConversationInput,
} from '@inwit/dto';
import { conversationActionSchema, conversationJobPayloadSchema } from '@inwit/dto';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { enqueueJob } from '../jobs/enqueue.js';
import { getDb } from '../db/index.js';
import {
  agentConversations,
  agentMessages,
  documents,
  type AgentConversationRow,
  type AgentMessageRow,
  type JobRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { clipReason, conversationTitle, normalizeDocumentIds } from '../agent/conversation-logic.js';
import { assertOwnedLlmConfig } from '../llm/llm.service.js';

const MESSAGE_CAP = 200;

function iso(value: Date): string {
  return value.toISOString();
}

function readActions(value: unknown): ConversationAction[] {
  if (!Array.isArray(value)) return [];
  const actions: ConversationAction[] = [];
  for (const item of value) {
    const parsed = conversationActionSchema.safeParse(item);
    if (parsed.success) actions.push(parsed.data);
  }
  return actions;
}

function readDocumentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toConversation(row: AgentConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function titlesFor(
  userId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(and(eq(documents.userId, userId), inArray(documents.id, unique), isNull(documents.deletedAt)));
  return new Map(rows.map((row) => [row.id, row.title?.trim() || '未命名文档']));
}

function documentRefs(ids: readonly string[], titles: Map<string, string>): ConversationDocumentRef[] {
  return ids.map((id) => ({ id, title: titles.get(id) ?? '已删除' }));
}

function toMessage(row: AgentMessageRow, titles: Map<string, string>): ConversationMessage {
  const documentIds = readDocumentIds(row.documentIds);
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    thinking: row.thinking,
    activity: row.activity,
    documents: documentRefs(documentIds, titles),
    actions: readActions(row.actions),
    status: row.status,
    failReason: row.failReason,
    createdAt: iso(row.createdAt),
  };
}

async function ownedConversation(userId: string, id: string): Promise<AgentConversationRow> {
  const [row] = await getDb()
    .select()
    .from(agentConversations)
    .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)))
    .limit(1);
  if (!row) throw AppError.of(404, 'CONVERSATION_NOT_FOUND');
  return row;
}

async function keepOwned(userId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.userId, userId), inArray(documents.id, [...ids]), isNull(documents.deletedAt)));
  const have = new Set(rows.map((row) => row.id));
  return ids.filter((id) => have.has(id));
}

async function detailOf(userId: string, conversationId: string): Promise<ConversationDetail> {
  const conversation = await ownedConversation(userId, conversationId);
  const rows = await getDb()
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.userId, userId)))
    .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
    .limit(MESSAGE_CAP);
  rows.reverse();
  const ids = rows.flatMap((row) => readDocumentIds(row.documentIds));
  const titles = await titlesFor(userId, ids);
  return {
    ...toConversation(conversation),
    messages: rows.map((row) => toMessage(row, titles)),
  };
}

export async function listConversations(userId: string, limit: number): Promise<Conversation[]> {
  const rows = await getDb()
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.userId, userId))
    .orderBy(desc(agentConversations.updatedAt), desc(agentConversations.id))
    .limit(limit);
  return rows.map(toConversation);
}

export async function getConversation(userId: string, id: string): Promise<ConversationDetail> {
  return detailOf(userId, id);
}

export async function deleteConversation(userId: string, id: string): Promise<void> {
  const [row] = await getDb()
    .delete(agentConversations)
    .where(and(eq(agentConversations.id, id), eq(agentConversations.userId, userId)))
    .returning({ id: agentConversations.id });
  if (!row) throw AppError.of(404, 'CONVERSATION_NOT_FOUND');
}

async function assertNoPending(conversationId: string, userId: string): Promise<void> {
  const [pending] = await getDb()
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.conversationId, conversationId),
        eq(agentMessages.userId, userId),
        eq(agentMessages.role, 'assistant'),
        eq(agentMessages.status, 'pending'),
      ),
    )
    .limit(1);
  if (pending) throw AppError.of(409, 'CONVERSATION_BUSY');
}

export async function sendConversationMessage(
  userId: string,
  conversationId: string | null,
  input: SendConversationInput,
): Promise<ConversationDetail> {
  const documentIds = await keepOwned(userId, normalizeDocumentIds(input.documentIds));
  const dirtyDocumentIds = normalizeDocumentIds(input.dirtyDocumentIds, 8);
  const text = input.text.trim();
  if (input.llmConfigId) await assertOwnedLlmConfig(userId, input.llmConfigId);
  const now = new Date();

  const id = await getDb().transaction(async (tx) => {
    let conversation: AgentConversationRow;
    if (conversationId === null) {
      const [created] = await tx
        .insert(agentConversations)
        .values({ userId, title: conversationTitle(text), createdAt: now, updatedAt: now })
        .returning();
      if (!created) throw AppError.of(500, 'INTERNAL_ERROR');
      conversation = created;
    } else {
      const [existing] = await tx
        .select()
        .from(agentConversations)
        .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, userId)))
        .limit(1);
      if (!existing) throw AppError.of(404, 'CONVERSATION_NOT_FOUND');
      const [pending] = await tx
        .select({ id: agentMessages.id })
        .from(agentMessages)
        .where(
          and(
            eq(agentMessages.conversationId, existing.id),
            eq(agentMessages.userId, userId),
            eq(agentMessages.role, 'assistant'),
            eq(agentMessages.status, 'pending'),
          ),
        )
        .limit(1);
      if (pending) throw AppError.of(409, 'CONVERSATION_BUSY');
      conversation = existing;
      if (!existing.title) {
        await tx
          .update(agentConversations)
          .set({ title: conversationTitle(text) })
          .where(eq(agentConversations.id, existing.id));
      }
    }

    await tx.insert(agentMessages).values({
      conversationId: conversation.id,
      userId,
      role: 'user',
      content: text,
      documentIds,
      actions: [],
      status: 'done',
      createdAt: now,
    });
    const [assistant] = await tx
      .insert(agentMessages)
      .values({
        conversationId: conversation.id,
        userId,
        role: 'assistant',
        content: '',
        documentIds: [],
        actions: [],
        status: 'pending',
        createdAt: new Date(now.getTime() + 1),
      })
      .returning();
    if (!assistant) throw AppError.of(500, 'INTERNAL_ERROR');
    const job = await enqueueJob(tx, {
      userId,
      type: 'conversation',
      payload: {
        conversationId: conversation.id,
        assistantMessageId: assistant.id,
        dirtyDocumentIds,
        text,
        ...(input.llmConfigId ? { llmConfigId: input.llmConfigId } : {}),
      },
    });
    await tx
      .update(agentMessages)
      .set({ jobId: job.id })
      .where(eq(agentMessages.id, assistant.id));
    await tx
      .update(agentConversations)
      .set({ updatedAt: now })
      .where(eq(agentConversations.id, conversation.id));
    return conversation.id;
  });

  return detailOf(userId, id);
}

export async function retryConversationMessage(
  userId: string,
  conversationId: string,
  messageId: string,
  input: RetryConversationInput,
): Promise<ConversationDetail> {
  await ownedConversation(userId, conversationId);
  await assertNoPending(conversationId, userId);
  if (input.llmConfigId) await assertOwnedLlmConfig(userId, input.llmConfigId);
  const [message] = await getDb()
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.id, messageId),
        eq(agentMessages.conversationId, conversationId),
        eq(agentMessages.userId, userId),
      ),
    )
    .limit(1);
  if (!message || message.role !== 'assistant' || message.status !== 'failed') {
    throw AppError.of(409, 'MESSAGE_NOT_RETRYABLE');
  }
  const [latest] = await getDb()
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
    .limit(1);
  if (!latest || latest.id !== message.id) throw AppError.of(409, 'MESSAGE_NOT_RETRYABLE');

  const [userMessage] = await getDb()
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.conversationId, conversationId),
        eq(agentMessages.role, 'user'),
        eq(agentMessages.userId, userId),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(1);

  await getDb().transaction(async (tx) => {
    const job = await enqueueJob(tx, {
      userId,
      type: 'conversation',
      payload: {
        conversationId,
        assistantMessageId: message.id,
        dirtyDocumentIds: normalizeDocumentIds(input.dirtyDocumentIds, 8),
        text: userMessage?.content ?? '',
        ...(input.llmConfigId ? { llmConfigId: input.llmConfigId } : {}),
      },
    });
    await tx
      .update(agentMessages)
      .set({
        status: 'pending',
        content: '',
        thinking: '',
        activity: null,
        actions: [],
        failReason: null,
        jobId: job.id,
      })
      .where(eq(agentMessages.id, message.id));
    await tx
      .update(agentConversations)
      .set({ updatedAt: new Date() })
      .where(eq(agentConversations.id, conversationId));
  });
  return detailOf(userId, conversationId);
}

export async function patchConversationDraft(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
  thinking: string;
  activity: string | null;
}): Promise<void> {
  await getDb()
    .update(agentMessages)
    .set({
      content: input.content,
      thinking: input.thinking,
      activity: input.activity,
    })
    .where(
      and(
        eq(agentMessages.id, input.messageId),
        eq(agentMessages.conversationId, input.conversationId),
        eq(agentMessages.userId, input.userId),
        eq(agentMessages.status, 'pending'),
      ),
    );
}

export async function completeConversationMessage(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  content: string;
  thinking: string;
  actions: ConversationAction[];
}): Promise<void> {
  const now = new Date();
  await getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(agentMessages)
      .set({
        content: input.content,
        thinking: input.thinking,
        activity: null,
        actions: input.actions,
        status: 'done',
        failReason: null,
      })
      .where(
        and(
          eq(agentMessages.id, input.messageId),
          eq(agentMessages.conversationId, input.conversationId),
          eq(agentMessages.userId, input.userId),
          eq(agentMessages.status, 'pending'),
        ),
      )
      .returning({ id: agentMessages.id });
    if (!updated) return;
    await tx
      .update(agentConversations)
      .set({ updatedAt: now })
      .where(eq(agentConversations.id, input.conversationId));
  });
}

export async function failConversationMessage(job: JobRow, reason: string): Promise<void> {
  if (job.type !== 'conversation') return;
  const parsed = conversationJobPayloadSchema.safeParse(job.payload);
  if (!parsed.success) return;
  await getDb()
    .update(agentMessages)
    .set({
      status: 'failed',
      activity: null,
      failReason: clipReason(reason),
    })
    .where(
      and(
        eq(agentMessages.id, parsed.data.assistantMessageId),
        eq(agentMessages.conversationId, parsed.data.conversationId),
        eq(agentMessages.userId, job.userId),
        eq(agentMessages.status, 'pending'),
      ),
    );
}

export async function loadConversationRun(userId: string, conversationId: string, messageId: string): Promise<{
  mentions: { id: string; title: string }[];
  earlier: { role: 'user' | 'assistant'; content: string }[];
  latest: string;
} | null> {
  const [assistant] = await getDb()
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.id, messageId),
        eq(agentMessages.conversationId, conversationId),
        eq(agentMessages.userId, userId),
      ),
    )
    .limit(1);
  if (!assistant || assistant.status !== 'pending') return null;
  const rows = await getDb()
    .select()
    .from(agentMessages)
    .where(
      and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.userId, userId)),
    )
    .orderBy(asc(agentMessages.createdAt), asc(agentMessages.id));
  const prior = rows.filter((row) => row.id !== assistant.id);
  const latestUser = [...prior].reverse().find((row) => row.role === 'user');
  if (!latestUser) return null;
  const mentionIds = readDocumentIds(latestUser.documentIds);
  const titles = await titlesFor(userId, mentionIds);
  const earlier = prior
    .filter((row) => row.id !== latestUser.id && (row.role === 'user' || row.status === 'done'))
    .map((row) => ({ role: row.role, content: row.content }));
  return {
    mentions: documentRefs(mentionIds, titles),
    earlier,
    latest: latestUser.content,
  };
}
