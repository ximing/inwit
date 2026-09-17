import { documentIdFromJobPayload } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents, type JobRow } from '../db/schema.js';
import { documentPlainText } from '../documents/content-json.js';
import { findOwnedDocument } from '../documents/document.service.js';
import { markDocumentFailed } from '../documents/document-status.js';
import { tryIndexOwnedDocument } from '../retrieval/document-index.js';
import { logger } from '../utils/logger.js';
import {
  associationHintForCards,
  cleanupDocumentCards,
  countOutgoingLinks,
  loadDocumentCards,
} from './card-harvest.js';
import { ensureDocumentMeta } from './doc-meta.js';
import { extractAssistantText } from './messages.js';
import { CHAT_SYSTEM_PROMPT, chatUserPrompt } from './prompts.js';
import { AgentTerminalError, runAgentJob } from './run-agent-job.js';
import { chatTools, type DigestSession } from './tools.js';

async function markChatDigested(id: string, answer: string | null, linkHint?: string | null): Promise<void> {
  await getDb()
    .update(documents)
    .set({
      status: 'digested',
      failReason: null,
      answer,
      updatedAt: new Date(),
      ...(linkHint !== undefined ? { linkHint } : {}),
    })
    .where(eq(documents.id, id));
}

export async function processChat(job: JobRow): Promise<void> {
  const documentId = documentIdFromJobPayload(job.payload);
  if (!documentId) throw new Error('chat job missing documentId');

  const document = await findOwnedDocument(job.userId, documentId);
  if (!document) {
    logger.warn('chat.document_missing', { jobId: job.id, documentId });
    return;
  }
  if (document.status === 'digested') {
    logger.info('chat.already_done', { jobId: job.id, documentId });
    return;
  }

  await cleanupDocumentCards(job.userId, documentId);

  const session: DigestSession = {
    userId: job.userId,
    documentId,
    writtenCardIds: [],
    cardSource: 'chat',
    dueImmediately: true,
  };
  const question =
    typeof job.payload.question === 'string' && job.payload.question.trim().length > 0
      ? job.payload.question
      : documentPlainText(document.contentJson);

  await runAgentJob({
    job,
    agentType: 'chat',
    systemPrompt: CHAT_SYSTEM_PROMPT,
    userPrompt: chatUserPrompt({ documentId, question }),
    tools: chatTools(session),
    context: { documentId },
    verify: async ({ agent, executionId }) => {
      const answerText = extractAssistantText(agent.state.messages);
      if (answerText.length === 0) {
        throw new AgentTerminalError('chat produced no answer', 'answer=0');
      }

      const produced = await loadDocumentCards(job.userId, documentId);
      if (produced.length === 0) {
        // Keep the answer on the failed document; the queue settles status/reason.
        await markDocumentFailed(job.userId, documentId, 'chat produced no cards', {
          answer: answerText,
        });
        throw new AgentTerminalError('chat produced no cards', 'cards=0');
      }
      const missingQuestions = produced.filter((card) => card.questionCount < 1);
      if (missingQuestions.length > 0) {
        throw new Error(`chat missing questions for ${String(missingQuestions.length)} card(s)`);
      }

      const cardIds = produced.map((card) => card.id);
      const hint = await associationHintForCards(job.userId, cardIds);
      const linkN = await countOutgoingLinks(job.userId, cardIds);
      await markChatDigested(documentId, answerText, hint);
      try {
        await ensureDocumentMeta({
          userId: job.userId,
          documentId,
          executionId,
          alreadyWritten: session.documentMetaWritten === true,
        });
      } catch (err) {
        logger.warn('chat.meta_failed', {
          jobId: job.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await tryIndexOwnedDocument(job.userId, documentId);
      return `answer_chars=${String(answerText.length)} cards=${String(produced.length)} questions=${String(
        produced.reduce((sum, card) => sum + card.questionCount, 0),
      )} links=${String(linkN)}${hint ? ' same_concept_hint=1' : ''}`;
    },
    nudgePrompt: (err) =>
      `流程验收未通过：${err instanceof Error ? err.message : String(err)}。请继续：确保回答已写在消息正文，并调用 write_cards（1-3 张）、对每张卡 write_questions、最后 set_document_meta。必须调用工具落库，不要只回复文字。`,
  });
}
