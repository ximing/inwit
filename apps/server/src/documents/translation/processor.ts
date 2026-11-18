import { createTranslationDraftSink, writeTranslationDraft } from './translation-draft.js';
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { logTranslationUsage } from "../../llm/translation-usage.js";
import { getDb } from "../../db/index.js";
import {
  documents,
  jobs,
  pdfTranslationContents,
  pdfTranslationJobs,
  pdfTranslations,
  type JobRow,
  type PdfTranslationJobRow,
} from "../../db/schema.js";
import {
  completeTranslation,
  type TranslationCallResult,
} from "../../llm/translation-call.js";
import {
  readTranslationCredential,
  cleanupTranslationCredentials,
} from "../../llm/translation-settings.service.js";
import { UNKNOWN_USAGE } from "./translation-logic.js";
import type { TranslationTx } from "./translation.service.js";

async function lockTask(tx: TranslationTx, task: PdfTranslationJobRow) {
  const [doc] = await tx
    .select()
    .from(documents)
    .where(
      and(eq(documents.id, task.documentId), eq(documents.userId, task.userId)),
    )
    .for("update");
  const [content] = await tx
    .select()
    .from(pdfTranslationContents)
    .where(
      and(
        eq(pdfTranslationContents.id, task.contentId),
        eq(pdfTranslationContents.userId, task.userId),
      ),
    )
    .for("update");
  const [current] = await tx
    .select()
    .from(pdfTranslationJobs)
    .where(
      and(
        eq(pdfTranslationJobs.id, task.id),
        eq(pdfTranslationJobs.userId, task.userId),
      ),
    )
    .for("update");
  return { doc, content, current };
}
async function finish(
  task: PdfTranslationJobRow,
  token: string,
  result: TranslationCallResult,
) {
  await getDb().transaction(async (tx) => {
    const { doc, content, current } = await lockTask(tx, task);
    if (
      !current ||
      !content ||
      current.executionToken !== token ||
      !["preparing", "dispatched"].includes(current.state) ||
      content.activeJobId !== task.id ||
      content.generationRevision !== task.generationRevision
    )
      return;
    const valid =
      doc && !doc.deletedAt && doc.fileRevision === content.fileRevision;
    const state = valid ? result.status : "failed";
    const now = new Date();
    let translationId: string | null = null;
    const usage = {
      usageStatus: result.usageStatus,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.totalTokens,
    };
    if (state === "succeeded" && result.text?.trim()) {
      const [saved] = await tx
        .insert(pdfTranslations)
        .values({
          userId: task.userId,
          documentId: task.documentId,
          contentId: content.id,
          generationKey: task.generationKey,
          generationRevision: task.generationRevision,
          fileRevision: content.fileRevision,
          pageIndex: content.pageIndex,
          sourceText: content.sourceText,
          translatedText: result.text,
          modelSnapshot: task.modelSnapshot,
          promptVersion: task.promptVersion,
          contextHash: task.contextHash,
          usage,
        })
        .returning();
      translationId = saved!.id;
    }
    const finalState =
      state === "succeeded" && !translationId ? "failed" : state;
    await tx
      .update(pdfTranslationJobs)
      .set({
        state: finalState,
        ...(finalState === 'succeeded' ? { draftText: '' } : {}),
        draftSeq: sql`${pdfTranslationJobs.draftSeq} + 1`,
        translationId,
        usage,
        errorCode: valid
          ? (result.errorCode ??
            (finalState === "failed" ? "PDF_TRANSLATION_EMPTY" : null))
          : "PDF_VERSION_CONFLICT",
        executionToken: null,
        leaseUntil: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(pdfTranslationJobs.id, task.id));
    await tx
      .update(pdfTranslationContents)
      .set({
        activeJobId: null,
        ...(translationId ? { currentTranslationId: translationId } : {}),
      })
      .where(eq(pdfTranslationContents.id, content.id));
    await tx
      .update(jobs)
      .set({
        status: finalState === "succeeded" ? "done" : "failed",
        finishedAt: now,
        updatedAt: now,
        lastError:
          finalState === "succeeded"
            ? null
            : (result.errorCode ?? "PDF_TRANSLATION_FAILED"),
      })
      .where(and(eq(jobs.id, task.jobId), eq(jobs.userId, task.userId)));
  });
  await logTranslationUsage(task.userId, task.modelSnapshot, result, task.id);
  await cleanupTranslationCredentials(task.userId);
}
export async function processPdfTranslation(carrier: JobRow): Promise<void> {
  const id =
    "translationJobId" in carrier.payload
      ? carrier.payload.translationJobId
      : null;
  if (typeof id !== "string") return;
  const [task] = await getDb()
    .select()
    .from(pdfTranslationJobs)
    .where(
      and(
        eq(pdfTranslationJobs.id, id),
        eq(pdfTranslationJobs.userId, carrier.userId),
        eq(pdfTranslationJobs.jobId, carrier.id),
      ),
    );
  if (
    !task ||
    !["queued", "preparing"].includes(task.state) ||
    task.dispatchedAt
  )
    return;
  const token = randomUUID();
  const prepared = await getDb().transaction(async (tx) => {
    const { doc, content, current } = await lockTask(tx, task);
    if (
      !current ||
      !content ||
      !["queued", "preparing"].includes(current.state) ||
      current.dispatchedAt ||
      content.activeJobId !== task.id
    )
      return false;
    if (
      current.state === "preparing" &&
      current.leaseUntil &&
      current.leaseUntil > new Date()
    )
      return false;
    const now = new Date();
    await tx
      .update(pdfTranslationJobs)
      .set({
        state: "preparing",
        executionToken: token,
        attempts: current.attempts + 1,
        heartbeatAt: now,
        leaseUntil: new Date(now.getTime() + 120000),
        updatedAt: now,
      })
      .where(eq(pdfTranslationJobs.id, task.id));
    return true;
  });
  if (!prepared) return;
  let dispatch: { apiKey: string; sourceText: string } | null = null;
  try {
    dispatch = await getDb().transaction(async (tx) => {
      const { doc, content, current } = await lockTask(tx, task);
      if (
        !current ||
        !content ||
        current.executionToken !== token ||
        current.state !== "preparing" ||
        current.dispatchedAt ||
        content.activeJobId !== task.id
      )
        return null;
      if (!doc || doc.deletedAt || doc.fileRevision !== content.fileRevision)
        throw new Error("PDF_VERSION_CONFLICT");
      const apiKey = await readTranslationCredential(
        tx,
        task.userId,
        task.credentialVersionId,
      );
      const now = new Date();
      await tx
        .update(pdfTranslationJobs)
        .set({
          state: "dispatched",
          dispatchedAt: now,
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(pdfTranslationJobs.id, task.id));
      return { apiKey, sourceText: content.sourceText };
    });
  } catch {
    await finish(task, token, {
      status: "failed",
      errorCode: "PDF_TRANSLATION_CREDENTIAL_OR_DOCUMENT_UNAVAILABLE",
      ...UNKNOWN_USAGE,
    });
    return;
  }
  if (!dispatch) return;
  const heartbeat = setInterval(() => {
    const now = new Date();
    void getDb()
      .update(pdfTranslationJobs)
      .set({ heartbeatAt: now, leaseUntil: new Date(now.getTime() + 120000) })
      .where(
        and(
          eq(pdfTranslationJobs.id, task.id),
          eq(pdfTranslationJobs.executionToken, token),
          eq(pdfTranslationJobs.state, "dispatched"),
        ),
      )
      .catch(() => {});
  }, 15000);
  const draft = createTranslationDraftSink(text => writeTranslationDraft(task, token, text));
  try {
    const result = await completeTranslation(
      task.modelSnapshot,
      dispatch.apiKey,
      dispatch.sourceText,
      task.contextText,
      text => draft.push(text),
    );
    await draft.finish();
    await finish(task, token, result);
  } finally {
    await draft.finish();
    clearInterval(heartbeat);
    dispatch.apiKey = "";
  }
}
