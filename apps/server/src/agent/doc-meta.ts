import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { documents } from '../db/schema.js';
import { completeChat } from '../llm/usage.js';
import { logger } from '../utils/logger.js';
import {
  DOCUMENT_META_SYSTEM_PROMPT,
  clipChars,
  documentMetaUserPrompt,
  isEmptyMetaPatch,
  isTooShortForDocumentMeta,
  isUserOwnedTitle,
  needsDocumentMeta,
  parseDocumentMetaProposal,
  resolveDocumentMetaPatch,
} from './doc-meta-logic.js';

const CONTENT_CLIP = 4000;
const META_MAX_TOKENS = 256;

export async function persistDocumentMeta(input: {
  userId: string;
  documentId: string;
  existingTitle: string | null;
  existingDescription: string | null;
  proposedTitle: unknown;
  proposedDescription: unknown;
}): Promise<{
  title: string | null;
  description: string | null;
  wroteTitle: boolean;
  wroteDescription: boolean;
}> {
  const patch = resolveDocumentMetaPatch(input);
  if (isEmptyMetaPatch(patch)) {
    return {
      title: input.existingTitle,
      description: input.existingDescription,
      wroteTitle: false,
      wroteDescription: false,
    };
  }
  const [row] = await getDb()
    .update(documents)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)))
    .returning({ title: documents.title, description: documents.description });
  return {
    title: row?.title ?? input.existingTitle,
    description: row?.description ?? input.existingDescription,
    wroteTitle: patch.title !== undefined,
    wroteDescription: patch.description !== undefined,
  };
}

/** After digest/chat: write title/description if the agent did not already. Failures are non-fatal. */
export async function ensureDocumentMeta(input: {
  userId: string;
  documentId: string;
  executionId: string | null;
  alreadyWritten?: boolean;
}): Promise<void> {
  if (input.alreadyWritten) return;
  const [row] = await getDb()
    .select({
      title: documents.title,
      description: documents.description,
      contentMd: documents.contentMd,
    })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)))
    .limit(1);
  if (!row) return;
  if (!needsDocumentMeta(row)) return;
  if (isTooShortForDocumentMeta(row.contentMd)) return;

  let text: string;
  try {
    const result = await completeChat(
      input.userId,
      {
        systemPrompt: DOCUMENT_META_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: documentMetaUserPrompt({
              contentMd: clipChars(row.contentMd, CONTENT_CLIP),
              keepTitle: isUserOwnedTitle(row.title),
              existingTitle: row.title,
            }),
          },
        ],
        maxTokens: META_MAX_TOKENS,
      },
      { executionId: input.executionId },
    );
    text = result.text;
  } catch (err) {
    logger.warn('document.meta_llm_failed', {
      documentId: input.documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const proposed = parseDocumentMetaProposal(text);
  try {
    await persistDocumentMeta({
      userId: input.userId,
      documentId: input.documentId,
      existingTitle: row.title,
      existingDescription: row.description,
      proposedTitle: proposed.title,
      proposedDescription: proposed.description,
    });
  } catch (err) {
    logger.warn('document.meta_persist_failed', {
      documentId: input.documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
