import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import {
  documents,
  jobs,
  pdfTranslationContents,
  pdfTranslationJobs,
  type JobRow,
} from '../db/schema.js';
import { AppError } from '../errors.js';
import { cleanupTranslationCredentials } from '../llm/translation-settings.service.js';

/** Used by every generic task surface; a deleted document makes its task inaccessible. */
export const visibleTranslationJob = () =>
  sql`(${jobs.type} <> 'pdf_translate' OR EXISTS (SELECT 1 FROM ${pdfTranslationJobs} ptj JOIN ${documents} d ON d.id = ptj.document_id WHERE ptj.job_id = ${jobs.id} AND ptj.user_id = ${jobs.userId} AND d.user_id = ${jobs.userId} AND d.deleted_at IS NULL))`;

async function settleCarrier(
  job: JobRow,
  mode: 'cancel' | 'failure' | 'recover',
  now: Date,
  cutoff?: Date,
): Promise<JobRow | undefined> {
  const result = await getDb().transaction(async (tx) => {
    const [initial] = await tx
      .select()
      .from(pdfTranslationJobs)
      .where(and(eq(pdfTranslationJobs.jobId, job.id), eq(pdfTranslationJobs.userId, job.userId)));
    if (!initial) return undefined;
    await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, initial.documentId), eq(documents.userId, job.userId)))
      .for('update');
    await tx
      .select({ id: pdfTranslationContents.id })
      .from(pdfTranslationContents)
      .where(
        and(
          eq(pdfTranslationContents.id, initial.contentId),
          eq(pdfTranslationContents.userId, job.userId),
        ),
      )
      .for('update');
    const [business] = await tx
      .select()
      .from(pdfTranslationJobs)
      .where(and(eq(pdfTranslationJobs.id, initial.id), eq(pdfTranslationJobs.userId, job.userId)))
      .for('update');
    const [carrier] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId)))
      .for('update');
    if (!business || !carrier) return undefined;
    if (mode === 'failure' && (carrier.status !== 'running' || carrier.attempts !== job.attempts))
      return undefined;
    if (
      mode === 'recover' &&
      cutoff &&
      (carrier.updatedAt > cutoff || (business.leaseUntil && business.leaseUntil > now))
    )
      return undefined;
    const active = ['queued', 'preparing', 'dispatched'].includes(business.state);
    if (mode === 'cancel' && (!active || business.dispatchedAt || business.state === 'dispatched'))
      throw AppError.of(409, 'JOB_NOT_CANCELABLE');
    if (!active) {
      if (mode === 'cancel') return undefined;
      const [row] = await tx
        .update(jobs)
        .set({
          status: business.state === 'succeeded' ? 'done' : 'failed',
          lastError: business.errorCode,
          finishedAt: business.finishedAt ?? now,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId)))
        .returning();
      return row;
    }
    if (mode === 'recover' && !business.dispatchedAt && business.state !== 'dispatched') {
      await tx
        .update(pdfTranslationJobs)
        .set({
          state: 'queued',
          executionToken: null,
          leaseUntil: null,
          heartbeatAt: null,
          updatedAt: now,
        })
        .where(
          and(eq(pdfTranslationJobs.id, business.id), eq(pdfTranslationJobs.userId, job.userId)),
        );
      const [row] = await tx
        .update(jobs)
        .set({ status: 'pending', runAt: now, updatedAt: now })
        .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId)))
        .returning();
      return row;
    }
    const state =
      mode === 'cancel'
        ? 'cancelled'
        : business.dispatchedAt || business.state === 'dispatched'
          ? 'unknown'
          : 'failed';
    const errorCode =
      state === 'cancelled'
        ? 'PDF_TRANSLATION_CANCELLED'
        : state === 'unknown'
          ? 'PDF_TRANSLATION_OUTCOME_UNKNOWN'
          : 'PDF_TRANSLATION_EXECUTION_FAILED';
    await tx
      .update(pdfTranslationJobs)
      .set({
        state,
        errorCode,
        executionToken: null,
        leaseUntil: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(pdfTranslationJobs.id, business.id), eq(pdfTranslationJobs.userId, job.userId)),
      );
    await tx
      .update(pdfTranslationContents)
      .set({ activeJobId: null, latestJobId: business.id })
      .where(
        and(
          eq(pdfTranslationContents.id, business.contentId),
          eq(pdfTranslationContents.userId, job.userId),
          eq(pdfTranslationContents.activeJobId, business.id),
        ),
      );
    const [row] = await tx
      .update(jobs)
      .set({ status: 'failed', lastError: errorCode, finishedAt: now, updatedAt: now })
      .where(and(eq(jobs.id, job.id), eq(jobs.userId, job.userId)))
      .returning();
    return row;
  });
  if (result) await cleanupTranslationCredentials(job.userId);
  return result;
}
export async function cancelPdfTranslationCarrier(
  job: JobRow,
  now = new Date(),
): Promise<JobRow | undefined> {
  return settleCarrier(job, 'cancel', now);
}
export async function failPdfTranslationCarrier(job: JobRow, now = new Date()): Promise<void> {
  await settleCarrier(job, 'failure', now);
}
export async function recoverPdfTranslationCarriers(cutoff: Date, now: Date): Promise<number> {
  const stale = await getDb()
    .select()
    .from(jobs)
    .where(
      and(eq(jobs.type, 'pdf_translate'), eq(jobs.status, 'running'), lte(jobs.updatedAt, cutoff)),
    );
  let recovered = 0;
  for (const job of stale) {
    if (await settleCarrier(job, 'recover', now, cutoff)) recovered++;
  }
  return recovered;
}
