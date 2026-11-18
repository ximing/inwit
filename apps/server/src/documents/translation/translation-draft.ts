import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/index.js';
import {
  documents,
  pdfTranslationContents,
  pdfTranslationJobs,
  type PdfTranslationJobRow,
} from '../../db/schema.js';

/** Same lock order as dispatch/cancel/finalization; stale workers never publish a draft. */
export async function writeTranslationDraft(
  task: PdfTranslationJobRow,
  token: string,
  text: string,
): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, task.documentId), eq(documents.userId, task.userId)))
      .for('update');
    const [content] = await tx
      .select()
      .from(pdfTranslationContents)
      .where(
        and(
          eq(pdfTranslationContents.id, task.contentId),
          eq(pdfTranslationContents.userId, task.userId),
        ),
      )
      .for('update');
    if (
      !doc ||
      doc.deletedAt ||
      !content ||
      doc.fileRevision !== content.fileRevision ||
      content.activeJobId !== task.id ||
      content.generationRevision !== task.generationRevision
    )
      return;
    await tx
      .update(pdfTranslationJobs)
      .set({
        draftText: text,
        draftSeq: sql`${pdfTranslationJobs.draftSeq} + 1`,
        draftUpdatedAt: new Date(),
      })
      .where(
        and(
          eq(pdfTranslationJobs.id, task.id),
          eq(pdfTranslationJobs.userId, task.userId),
          eq(pdfTranslationJobs.executionToken, token),
          eq(pdfTranslationJobs.state, 'dispatched'),
        ),
      );
  });
}

/** One in-flight write and one replaceable latest snapshot, never a token-sized write queue. */
export function createTranslationDraftSink(
  write: (text: string) => Promise<void>,
  intervalMs = 150,
) {
  let latest = '',
    written = '',
    first = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let finishing = false;
  const flush = () => {
    if (pending || latest === written) return;
    const text = latest;
    pending = write(text)
      .then(() => {
        written = text;
      })
      .catch(() => {
        // Draft delivery is best effort. Final commit remains authoritative; never retry the model.
        written = text;
      })
      .finally(() => {
        pending = undefined;
        if (!finishing && latest !== written) schedule();
      });
  };
  const schedule = () => {
    if (timer || pending) return;
    timer = setTimeout(() => {
      timer = undefined;
      flush();
    }, intervalMs);
    timer.unref?.();
  };
  return {
    push(text: string) {
      if (finishing) return;
      latest = text;
      if (first && text) {
        first = false;
        flush();
      } else schedule();
    },
    async finish() {
      finishing = true;
      if (timer) clearTimeout(timer);
      await pending;
      flush();
      await pending;
    },
  };
}
