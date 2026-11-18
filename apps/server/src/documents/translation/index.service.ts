import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import type { PdfSegmentsPage } from "@inwit/dto";
import { getDb } from "../../db/index.js";
import {
  documents,
  pdfSegmentPages,
  pdfSegments,
  pdfTranslationContents,
} from "../../db/schema.js";
import { AppError } from "../../errors.js";
import { getObjectToFile } from "../../storage/client.js";
import {
  parsePdfPage,
  readPdfPageGeometry,
  PDF_PARSER_VERSION,
} from "./pdf-parser.js";
import { identityHash } from "./translation-logic.js";
import { requireTranslationDocument } from "./translation.service.js";

export const PDF_INDEX_LEASE_MS = 120_000;
type PageRow = typeof pdfSegmentPages.$inferSelect;
const pageIdentity = (
  userId: string,
  documentId: string,
  revision: string,
  pageIndex: number,
) =>
  and(
    eq(pdfSegmentPages.userId, userId),
    eq(pdfSegmentPages.documentId, documentId),
    eq(pdfSegmentPages.fileRevision, revision),
    eq(pdfSegmentPages.parserVersion, PDF_PARSER_VERSION),
    eq(pdfSegmentPages.pageIndex, pageIndex),
  );
const expired = (page: PageRow) =>
  page.state === "indexing" &&
  page.updatedAt.getTime() <= Date.now() - PDF_INDEX_LEASE_MS;
export async function readPdfOriginal(fileKey: string): Promise<Uint8Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "inwit-pdf-index-"));
  try {
    const dest = path.join(dir, "source.pdf");
    await getObjectToFile(fileKey, dest);
    return new Uint8Array(await readFile(dest));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export function pdfFileRevision(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function buildPage(
  userId: string,
  documentId: string,
  pageIndex: number,
): Promise<void> {
  const doc = await requireTranslationDocument(getDb(), userId, documentId);
  // Download/hash can overlap across processes; expensive paragraph extraction cannot.
  const bytes = await readPdfOriginal(doc.fileKey!);
  const revision = pdfFileRevision(bytes);
  if (doc.fileRevision && doc.fileRevision !== revision)
    throw AppError.of(409, "PDF_VERSION_CONFLICT");
  const token = await getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.userId, userId),
          isNull(documents.deletedAt),
        ),
      )
      .for("update");
    if (!current) throw AppError.of(404, "DOCUMENT_NOT_FOUND");
    if (
      current.fileKey !== doc.fileKey ||
      (current.fileRevision && current.fileRevision !== revision)
    )
      throw AppError.of(409, "PDF_VERSION_CONFLICT");
    if (!current.fileRevision)
      await tx
        .update(documents)
        .set({ fileRevision: revision })
        .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));
    const [page] = await tx
      .select()
      .from(pdfSegmentPages)
      .where(pageIdentity(userId, documentId, revision, pageIndex))
      .for("update");
    if (page && !expired(page)) return null;
    const id = randomUUID(),
      now = new Date();
    if (page)
      await tx
        .update(pdfSegmentPages)
        .set({
          id,
          state: "indexing",
          geometry: null,
          diagnostics: [],
          updatedAt: now,
        })
        .where(
          and(
            eq(pdfSegmentPages.id, page.id),
            eq(pdfSegmentPages.userId, userId),
          ),
        );
    else
      await tx
        .insert(pdfSegmentPages)
        .values({
          id,
          userId,
          documentId,
          fileRevision: revision,
          parserVersion: PDF_PARSER_VERSION,
          pageIndex,
          state: "indexing",
          geometry: null,
          diagnostics: [],
          updatedAt: now,
        });
    return id;
  });
  if (!token) return;
  // No DB transaction or row lock is held during PDF engine work.
  let parsed: Pick<
    PdfSegmentsPage,
    "geometry" | "state" | "diagnostics" | "segments"
  >;
  try {
    parsed = await parsePdfPage(bytes, pageIndex);
  } catch {
    let geometry: PdfSegmentsPage["geometry"] = null;
    try {
      geometry = await readPdfPageGeometry(bytes, pageIndex);
    } catch {
      /* Metadata failure must also settle the lease. */
    }
    parsed = {
      geometry,
      state: "failed",
      diagnostics: ["段落索引失败；如可选择文字，仍可显式翻译选区"],
      segments: [],
    };
  }
  await getDb().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.userId, userId),
          isNull(documents.deletedAt),
        ),
      )
      .for("update");
    if (!current) throw AppError.of(404, "DOCUMENT_NOT_FOUND");
    if (current.fileKey !== doc.fileKey || current.fileRevision !== revision)
      throw AppError.of(409, "PDF_VERSION_CONFLICT");
    const [lease] = await tx
      .select()
      .from(pdfSegmentPages)
      .where(
        and(
          pageIdentity(userId, documentId, revision, pageIndex),
          eq(pdfSegmentPages.id, token),
          eq(pdfSegmentPages.state, "indexing"),
        ),
      )
      .for("update");
    if (!lease) return; // A reclaimed lease, including a late failure, cannot overwrite its successor.
    await tx
      .delete(pdfSegments)
      .where(
        and(
          eq(pdfSegments.userId, userId),
          eq(pdfSegments.documentId, documentId),
          eq(pdfSegments.fileRevision, revision),
          eq(pdfSegments.parserVersion, PDF_PARSER_VERSION),
          eq(pdfSegments.pageIndex, pageIndex),
        ),
      );
    if (parsed.segments.length)
      await tx
        .insert(pdfSegments)
        .values(
          parsed.segments.map((s) => ({
            ...s,
            id: identityHash([documentId, revision, PDF_PARSER_VERSION, s.id]),
            userId,
            documentId,
            fileRevision: revision,
            parserVersion: PDF_PARSER_VERSION,
          })),
        );
    await tx
      .update(pdfSegmentPages)
      .set({
        geometry: parsed.geometry,
        state: parsed.state,
        diagnostics: parsed.diagnostics,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pdfSegmentPages.id, token),
          eq(pdfSegmentPages.userId, userId),
          eq(pdfSegmentPages.state, "indexing"),
        ),
      );
  });
}

export async function getPdfSegments(
  userId: string,
  documentId: string,
  pageIndex: number,
): Promise<PdfSegmentsPage> {
  let doc = await requireTranslationDocument(getDb(), userId, documentId);
  let [page] = doc.fileRevision
    ? await getDb()
        .select()
        .from(pdfSegmentPages)
        .where(pageIdentity(userId, documentId, doc.fileRevision, pageIndex))
    : [];
  if (!page || expired(page)) {
    try {
      await buildPage(userId, documentId, pageIndex);
    } catch (error) {
      if (error instanceof AppError) throw error;
      await requireTranslationDocument(getDb(), userId, documentId);
      return {
        documentId,
        fileRevision: doc.fileRevision ?? "",
        parserVersion: PDF_PARSER_VERSION,
        pageIndex,
        geometry: null,
        segments: [],
        state: "failed",
        diagnostics: ["此页段落索引失败，可在文本层可用时选择文字翻译"],
      };
    }
    doc = await requireTranslationDocument(getDb(), userId, documentId);
    [page] = await getDb()
      .select()
      .from(pdfSegmentPages)
      .where(pageIdentity(userId, documentId, doc.fileRevision!, pageIndex));
  }
  if (!page) throw AppError.of(409, "PDF_INDEX_NOT_READY");
  const base = {
    documentId,
    fileRevision: page.fileRevision,
    parserVersion: PDF_PARSER_VERSION,
    pageIndex,
    geometry: page.geometry,
    state: page.state as PdfSegmentsPage["state"],
    diagnostics: page.diagnostics,
  };
  if (page.state === "indexing") return { ...base, segments: [] };
  const [segments, contents] = await Promise.all([
    getDb()
      .select()
      .from(pdfSegments)
      .where(
        and(
          eq(pdfSegments.userId, userId),
          eq(pdfSegments.documentId, documentId),
          eq(pdfSegments.fileRevision, page.fileRevision),
          eq(pdfSegments.parserVersion, PDF_PARSER_VERSION),
          eq(pdfSegments.pageIndex, pageIndex),
        ),
      )
      .orderBy(pdfSegments.ordinal),
    getDb()
      .select()
      .from(pdfTranslationContents)
      .where(
        and(
          eq(pdfTranslationContents.userId, userId),
          eq(pdfTranslationContents.documentId, documentId),
          eq(pdfTranslationContents.fileRevision, page.fileRevision),
          eq(pdfTranslationContents.pageIndex, pageIndex),
        ),
      ),
  ]);
  return {
    ...base,
    segments: segments.map((s) => ({
      id: s.id,
      pageIndex: s.pageIndex,
      ordinal: s.ordinal,
      sourceText: s.sourceText,
      textHash: s.textHash,
      rects: s.rects,
      qualityState: s.qualityState,
      hasTranslation: contents.some(
        (c) => c.segmentId === s.id && !!c.currentTranslationId,
      ),
    })),
  };
}
