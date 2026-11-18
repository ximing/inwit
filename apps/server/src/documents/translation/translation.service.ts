import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type {
  PdfQuad,
  PdfTranslation,
  PdfTranslationJob,
  PdfTranslationResponse,
  SelectionTranslationRequest,
  TranslationRequest,
} from "@inwit/dto";
import { getDb, type Database } from "../../db/index.js";
import {
  documents,
  jobs,
  pdfSegments,
  pdfSegmentPages,
  pdfTranslationContents,
  pdfTranslationJobs,
  pdfTranslations,
  pdfTranslationRequests,
  type PdfTranslationContentRow,
  type PdfTranslationJobRow,
  type PdfTranslationRow,
} from "../../db/schema.js";
import { AppError } from "../../errors.js";
import { enqueueJob } from "../../jobs/enqueue.js";
import { snapshotTranslationModel } from "../../llm/translation-settings.service.js";
import {
  anchorIdentity,
  sameSelection,
  identityHash,
  normalizedTranslationText,
  selectionWithinPage,
  translationContentKey,
  TRANSLATION_PROMPT_VERSION,
  UNKNOWN_USAGE,
} from "./translation-logic.js";
export type TranslationTx = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type Reader = Pick<Database, "select">;
export async function requireTranslationDocument(
  db: Reader,
  userId: string,
  documentId: string,
  revision?: string,
) {
  const [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, documentId),
        eq(documents.userId, userId),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);
  if (!doc) throw AppError.of(404, "DOCUMENT_NOT_FOUND");
  if (doc.fileMime !== "application/pdf" || !doc.fileKey)
    throw AppError.of(404, "DOCUMENT_FILE_NOT_FOUND");
  if (revision !== undefined && doc.fileRevision !== revision)
    throw AppError.of(409, "PDF_VERSION_CONFLICT");
  return doc;
}
export function publicTranslation(row: PdfTranslationRow): PdfTranslation {
  return {
    id: row.id,
    documentId: row.documentId,
    fileRevision: row.fileRevision,
    pageIndex: row.pageIndex,
    sourceText: row.sourceText,
    translatedText: row.translatedText,
    generationRevision: row.generationRevision,
    model: {
      provider: row.modelSnapshot.provider,
      model: row.modelSnapshot.model,
      baseUrl: row.modelSnapshot.baseUrl,
    },
    usage: row.usage,
    createdAt: row.createdAt.toISOString(),
  };
}
export async function publicTranslationJob(
  db: Reader,
  row: PdfTranslationJobRow,
): Promise<PdfTranslationJob> {
  const [translation] = row.translationId
    ? await db
        .select()
        .from(pdfTranslations)
        .where(
          and(
            eq(pdfTranslations.id, row.translationId),
            eq(pdfTranslations.userId, row.userId),
            eq(pdfTranslations.documentId, row.documentId),
          ),
        )
    : [];
  return {
    id: row.id,
    draft: row.draftUpdatedAt ? { streamId: row.streamId, seq: row.draftSeq.toString(), text: row.draftText, updatedAt: row.draftUpdatedAt.toISOString() } : null,
    generationRevision: row.generationRevision,
    fileRevision: (await db.select({ revision: pdfTranslationContents.fileRevision }).from(pdfTranslationContents).where(and(eq(pdfTranslationContents.id, row.contentId), eq(pdfTranslationContents.userId, row.userId))))[0]?.revision,
    state: row.state,
    errorCode: row.errorCode,
    translation: translation ? publicTranslation(translation) : null,
    usage: row.usage,
    canCancel: ["queued", "preparing"].includes(row.state) && !row.dispatchedAt,
  };
}
async function responseFor(
  db: Reader,
  content: PdfTranslationContentRow,
  jobId?: string | null,
  translationId?: string | null,
): Promise<PdfTranslationResponse> {
  const resultId = translationId ?? content.currentTranslationId;
  const [result] = resultId
    ? await db
        .select()
        .from(pdfTranslations)
        .where(
          and(
            eq(pdfTranslations.id, resultId),
            eq(pdfTranslations.userId, content.userId),
            eq(pdfTranslations.documentId, content.documentId),
          ),
        )
    : [];
  const taskId =
    jobId ?? content.activeJobId ?? (!result ? content.latestJobId : null);
  const [task] = taskId
    ? await db
        .select()
        .from(pdfTranslationJobs)
        .where(
          and(
            eq(pdfTranslationJobs.id, taskId),
            eq(pdfTranslationJobs.userId, content.userId),
            eq(pdfTranslationJobs.documentId, content.documentId),
          ),
        )
    : [];
  const publicJob = task ? await publicTranslationJob(db, task) : null;
  const translated =
    publicJob?.state === "succeeded" && publicJob.translation
      ? publicJob.translation
      : result
        ? publicTranslation(result)
        : null;
  return {
    cacheHit: !!translated,
    requestUsage: translated ? 0 : null,
    translation: translated,
    job: publicJob,
  };
}
type Source = {
  sourceKind: "segment" | "selection";
  segmentId: string | null;
  anchorKey: string | null;
  sourceText: string;
  textHash: string;
  rects: PdfQuad[];
  pageIndex: number;
  fileRevision: string;
};
async function claim(
  userId: string,
  documentId: string,
  source: Source,
  idempotencyKey: string,
  mode: "view" | "regenerate" | "retry",
  requestHash: string,
): Promise<PdfTranslationResponse> {
  return getDb().transaction(async (tx) => {
    // Serialize document deletion, content revision allocation, and idempotency aliases in this order.
    await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
      .for("update");
    await requireTranslationDocument(
      tx,
      userId,
      documentId,
      source.fileRevision,
    );
    const [replay] = await tx
      .select()
      .from(pdfTranslationRequests)
      .where(
        and(
          eq(pdfTranslationRequests.userId, userId),
          eq(pdfTranslationRequests.documentId, documentId),
          eq(pdfTranslationRequests.idempotencyKey, idempotencyKey),
        ),
      );
    if (replay) {
      if (replay.requestHash !== requestHash)
        throw AppError.of(409, "PDF_TRANSLATION_REQUEST_CONFLICT");
      const [content] = await tx
        .select()
        .from(pdfTranslationContents)
        .where(
          and(
            eq(pdfTranslationContents.id, replay.contentId),
            eq(pdfTranslationContents.userId, userId),
          ),
        );
      if (!content) throw AppError.of(404, "PDF_TRANSLATION_NOT_FOUND");
      return responseFor(tx, content, replay.jobId, replay.translationId);
    }
    const contentKey = translationContentKey({
      userId,
      documentId,
      fileRevision: source.fileRevision,
      pageIndex: source.pageIndex,
      sourceId: source.segmentId ?? source.anchorKey!,
      text: source.sourceText,
    });
    await tx
      .insert(pdfTranslationContents)
      .values({ ...source, userId, documentId, contentKey })
      .onConflictDoNothing();
    const [content] = await tx
      .select()
      .from(pdfTranslationContents)
      .where(
        and(
          eq(pdfTranslationContents.contentKey, contentKey),
          eq(pdfTranslationContents.userId, userId),
        ),
      )
      .for("update");
    if (!content) throw AppError.of(500, "INTERNAL_ERROR");
    const remember = async (
      jobId: string | null,
      translationId: string | null,
    ) => {
      await tx
        .insert(pdfTranslationRequests)
        .values({
          userId,
          documentId,
          idempotencyKey,
          requestHash,
          contentId: content.id,
          jobId,
          translationId,
        });
    };
    if (content.activeJobId) {
      await remember(content.activeJobId, content.currentTranslationId);
      return responseFor(tx, content);
    }
    if (
      mode === "view" &&
      (content.currentTranslationId || content.latestJobId)
    ) {
      await remember(
        content.currentTranslationId ? null : content.latestJobId,
        content.currentTranslationId,
      );
      return responseFor(tx, content);
    }
    const modelSnapshot = await snapshotTranslationModel(tx, userId);
    const revision = content.generationRevision + 1;
    const contextText = "";
    const contextHash = identityHash(contextText);
    const generationKey = identityHash([
      contentKey,
      modelSnapshot.provider,
      modelSnapshot.model,
      identityHash(modelSnapshot.baseUrl),
      TRANSLATION_PROMPT_VERSION,
      contextHash,
      "none",
      revision,
    ]);
    const id = randomUUID();
    const carrier = await enqueueJob(tx, {
      userId,
      type: "pdf_translate",
      payload: { translationJobId: id },
    });
    await tx
      .insert(pdfTranslationJobs)
      .values({
        id,
        userId,
        documentId,
        contentId: content.id,
        jobId: carrier.id,
        generationKey,
        generationRevision: revision,
        idempotencyKey,
        requestHash,
        modelSnapshot,
        credentialVersionId: modelSnapshot.credentialVersionId,
        promptVersion: TRANSLATION_PROMPT_VERSION,
        contextHash,
        contextText,
        usage: UNKNOWN_USAGE,
      });
    const [updated] = await tx
      .update(pdfTranslationContents)
      .set({ generationRevision: revision, activeJobId: id, latestJobId: id })
      .where(eq(pdfTranslationContents.id, content.id))
      .returning();
    await remember(id, content.currentTranslationId);
    return responseFor(tx, updated!, id);
  });
}
export async function requestSegmentTranslation(
  userId: string,
  documentId: string,
  input: TranslationRequest,
) {
  await requireTranslationDocument(
    getDb(),
    userId,
    documentId,
    input.fileRevision,
  );
  const [segment] = await getDb()
    .select()
    .from(pdfSegments)
    .where(
      and(
        eq(pdfSegments.id, input.segmentId),
        eq(pdfSegments.userId, userId),
        eq(pdfSegments.documentId, documentId),
        eq(pdfSegments.fileRevision, input.fileRevision),
        eq(pdfSegments.qualityState, "reliable"),
      ),
    );
  if (!segment) throw AppError.of(404, "PDF_SEGMENT_NOT_FOUND");
  return claim(
    userId,
    documentId,
    {
      sourceKind: "segment",
      segmentId: segment.id,
      anchorKey: null,
      sourceText: segment.sourceText,
      textHash: segment.textHash,
      rects: segment.rects,
      pageIndex: segment.pageIndex,
      fileRevision: input.fileRevision,
    },
    input.idempotencyKey,
    "view",
    identityHash(["segment", input.segmentId, input.fileRevision]),
  );
}
export async function requestSelectionTranslation(
  userId: string,
  documentId: string,
  input: SelectionTranslationRequest,
) {
  await requireTranslationDocument(
    getDb(),
    userId,
    documentId,
    input.fileRevision,
  );
  const [page] = await getDb()
    .select()
    .from(pdfSegmentPages)
    .where(
      and(
        eq(pdfSegmentPages.userId, userId),
        eq(pdfSegmentPages.documentId, documentId),
        eq(pdfSegmentPages.fileRevision, input.fileRevision),
        eq(pdfSegmentPages.pageIndex, input.pageIndex),
      ),
    );
  if (!page?.geometry) throw AppError.of(409, "PDF_INDEX_NOT_READY");
  if (
    !selectionWithinPage(
      input.rects,
      page.geometry.width,
      page.geometry.height,
    ) ||
    !normalizedTranslationText(input.text)
  )
    throw AppError.of(400, "PDF_SELECTION_INVALID");
  const segments = await getDb()
    .select()
    .from(pdfSegments)
    .where(
      and(
        eq(pdfSegments.userId, userId),
        eq(pdfSegments.documentId, documentId),
        eq(pdfSegments.fileRevision, input.fileRevision),
        eq(pdfSegments.pageIndex, input.pageIndex),
        eq(pdfSegments.qualityState, "reliable"),
      ),
    );
  const text = normalizedTranslationText(input.text),
    anchorKey = anchorIdentity(input.rects);
  const matches = segments.filter(
    (s) =>
      normalizedTranslationText(s.sourceText) === text &&
      sameSelection(input.rects, s.rects),
  );
  if (matches.length === 1)
    return requestSegmentTranslation(userId, documentId, {
      segmentId: matches[0]!.id,
      fileRevision: input.fileRevision,
      idempotencyKey: input.idempotencyKey,
    });
  return claim(
    userId,
    documentId,
    {
      sourceKind: "selection",
      segmentId: null,
      anchorKey,
      sourceText: input.text,
      textHash: identityHash(text),
      rects: input.rects,
      pageIndex: input.pageIndex,
      fileRevision: input.fileRevision,
    },
    input.idempotencyKey,
    "view",
    identityHash([
      "selection",
      input.fileRevision,
      input.pageIndex,
      text,
      anchorKey,
    ]),
  );
}
export async function getTranslationJob(
  userId: string,
  documentId: string,
  id: string,
) {
  const doc = await requireTranslationDocument(getDb(), userId, documentId);
  const [job] = await getDb()
    .select()
    .from(pdfTranslationJobs)
    .where(
      and(
        eq(pdfTranslationJobs.id, id),
        eq(pdfTranslationJobs.userId, userId),
        eq(pdfTranslationJobs.documentId, documentId),
      ),
    );
  if (!job) throw AppError.of(404, "PDF_TRANSLATION_NOT_FOUND");
  const [content] = await getDb()
    .select()
    .from(pdfTranslationContents)
    .where(
      and(
        eq(pdfTranslationContents.id, job.contentId),
        eq(pdfTranslationContents.userId, userId),
      ),
    );
  if (!content || content.fileRevision !== doc.fileRevision)
    throw AppError.of(409, "PDF_VERSION_CONFLICT");
  return publicTranslationJob(getDb(), job);
}
export async function retryTranslation(
  userId: string,
  documentId: string,
  id: string,
  input: {
    idempotencyKey: string;
    acknowledgeUnknownCharge?: boolean | undefined;
  },
) {
  await requireTranslationDocument(getDb(), userId, documentId);
  const [job] = await getDb()
    .select()
    .from(pdfTranslationJobs)
    .where(
      and(
        eq(pdfTranslationJobs.id, id),
        eq(pdfTranslationJobs.userId, userId),
        eq(pdfTranslationJobs.documentId, documentId),
      ),
    );
  if (!job) throw AppError.of(404, "PDF_TRANSLATION_NOT_FOUND");
  if (
    !["failed", "unknown", "cancelled"].includes(job.state) ||
    input.idempotencyKey === job.idempotencyKey
  )
    throw AppError.of(409, "PDF_TRANSLATION_RETRY_INVALID");
  if (job.state === "unknown" && !input.acknowledgeUnknownCharge)
    throw AppError.of(409, "PDF_TRANSLATION_UNKNOWN_ACK_REQUIRED");
  const [content] = await getDb()
    .select()
    .from(pdfTranslationContents)
    .where(
      and(
        eq(pdfTranslationContents.id, job.contentId),
        eq(pdfTranslationContents.userId, userId),
      ),
    );
  if (!content) throw AppError.of(404, "PDF_TRANSLATION_NOT_FOUND");
  return claim(
    userId,
    documentId,
    content,
    input.idempotencyKey,
    "retry",
    identityHash(["retry", id, !!input.acknowledgeUnknownCharge]),
  );
}
export async function regenerateTranslation(
  userId: string,
  documentId: string,
  id: string,
  idempotencyKey: string,
) {
  await requireTranslationDocument(getDb(), userId, documentId);
  const [translation] = await getDb()
    .select()
    .from(pdfTranslations)
    .where(
      and(
        eq(pdfTranslations.id, id),
        eq(pdfTranslations.userId, userId),
        eq(pdfTranslations.documentId, documentId),
      ),
    );
  if (!translation) throw AppError.of(404, "PDF_TRANSLATION_NOT_FOUND");
  const [content] = await getDb()
    .select()
    .from(pdfTranslationContents)
    .where(
      and(
        eq(pdfTranslationContents.id, translation.contentId),
        eq(pdfTranslationContents.userId, userId),
      ),
    );
  if (!content) throw AppError.of(404, "PDF_TRANSLATION_NOT_FOUND");
  return claim(
    userId,
    documentId,
    content,
    idempotencyKey,
    "regenerate",
    identityHash(["regenerate", id]),
  );
}
export async function readTranslations(
  userId: string,
  documentId: string,
  segmentIds: string[],
  fileRevision: string,
) {
  await requireTranslationDocument(getDb(), userId, documentId, fileRevision);
  const contents = await getDb()
    .select()
    .from(pdfTranslationContents)
    .where(
      and(
        eq(pdfTranslationContents.userId, userId),
        eq(pdfTranslationContents.documentId, documentId),
        eq(pdfTranslationContents.fileRevision, fileRevision),
        inArray(pdfTranslationContents.segmentId, segmentIds),
      ),
    );
  return Object.fromEntries(
    await Promise.all(
      contents.map(async (c) => [c.segmentId, await responseFor(getDb(), c)]),
    ),
  );
}
/** Caller holds the document row lock; dispatch uses the same document/content/business order. */
export async function cancelUndispatchedDocumentTranslations(
  tx: TranslationTx,
  userId: string,
  documentId: string,
  now = new Date(),
) {
  const contents = await tx
    .select()
    .from(pdfTranslationContents)
    .where(
      and(
        eq(pdfTranslationContents.userId, userId),
        eq(pdfTranslationContents.documentId, documentId),
      ),
    )
    .for("update");
  for (const content of contents) {
    if (!content.activeJobId) continue;
    const [task] = await tx
      .select()
      .from(pdfTranslationJobs)
      .where(
        and(
          eq(pdfTranslationJobs.id, content.activeJobId),
          eq(pdfTranslationJobs.userId, userId),
        ),
      )
      .for("update");
    if (
      !task ||
      !["queued", "preparing"].includes(task.state) ||
      task.dispatchedAt
    )
      continue;
    await tx
      .update(pdfTranslationJobs)
      .set({
        state: "cancelled",
        executionToken: null,
        leaseUntil: null,
        errorCode: "PDF_TRANSLATION_DOCUMENT_DELETED",
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(pdfTranslationJobs.id, task.id));
    await tx
      .update(pdfTranslationContents)
      .set({ activeJobId: null })
      .where(eq(pdfTranslationContents.id, content.id));
    await tx
      .update(jobs)
      .set({
        status: "failed",
        lastError: "PDF_TRANSLATION_DOCUMENT_DELETED",
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, task.jobId), eq(jobs.userId, userId)));
  }
}
export async function deleteDocumentTranslationCarriers(
  tx: TranslationTx,
  userId: string,
  documentId: string,
) {
  await tx
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .for("update");
  const tasks = await tx
    .select({ jobId: pdfTranslationJobs.jobId })
    .from(pdfTranslationJobs)
    .where(
      and(
        eq(pdfTranslationJobs.userId, userId),
        eq(pdfTranslationJobs.documentId, documentId),
      ),
    );
  if (tasks.length)
    await tx.delete(jobs).where(
      and(
        eq(jobs.userId, userId),
        inArray(
          jobs.id,
          tasks.map((t) => t.jobId),
        ),
        eq(jobs.type, "pdf_translate"),
      ),
    );
}
