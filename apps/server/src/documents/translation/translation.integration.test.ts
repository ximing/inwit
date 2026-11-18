import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  documents,
  jobs,
  llmConfigs,
  llmCredentialVersions,
  pdfSegments,
  pdfTranslationContents,
  pdfTranslationJobs,
  pdfTranslations,
  userTranslationSettings,
} from "../../db/schema.js";
import {
  isolatedDbContext,
  setupIsolatedDb,
  teardownIsolatedDb,
} from "../../testkit/context.js";
import { seedUser } from "../../testkit/fixtures.js";
import type { IsolatedDb } from "../../testkit/isolated-db.js";
import { encryptSecret } from "../../llm/crypto.js";
import {
  cancelPdfTranslationCarrier,
  recoverPdfTranslationCarriers,
} from "../../jobs/pdf-translation-lifecycle.js";
import { retryJob } from "../../jobs/jobs.service.js";
import { completeTranslation } from "../../llm/translation-call.js";
import { deleteTranslationSettings } from "../../llm/translation-settings.service.js";
import {
  cancelUndispatchedDocumentTranslations,
  deleteDocumentTranslationCarriers,
  requestSelectionTranslation,
  getTranslationJob,
  regenerateTranslation,
  requestSegmentTranslation,
  retryTranslation,
} from "./translation.service.js";
import { processPdfTranslation } from "./processor.js";
import { getPdfSegments } from "./index.service.js";
import { UNKNOWN_USAGE } from "./translation-logic.js";
vi.mock("../../llm/translation-call.js", () => ({
  completeTranslation: vi.fn(),
}));
vi.mock("./pdf-parser.js", () => ({
  PDF_PARSER_VERSION: "test-fallback",
  parsePdfPage: vi.fn(async () => {
    throw new Error("parser failure");
  }),
  readPdfPageGeometry: vi.fn(async () => ({
    coordinateVersion: "crop-local-points-v1",
    cropBox: [0, 0, 100, 100],
    userUnit: 1,
    intrinsicRotation: 0,
    width: 100,
    height: 100,
  })),
}));
vi.mock("../../storage/client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../storage/client.js")>();
  return {
    ...actual,
    getObjectToFile: async (_key: string, dest: string) => {
      await (
        await import("node:fs/promises")
      ).writeFile(dest, "test-pdf-bytes");
    },
  };
});
const model = vi.mocked(completeTranslation);
const ctx = isolatedDbContext();
describe.skipIf(!ctx.available)(
  "PDF translation real PostgreSQL concurrency and lifecycle",
  () => {
    let iso: IsolatedDb;
    beforeAll(async () => {
      iso = await setupIsolatedDb();
    });
    afterAll(async () => {
      await teardownIsolatedDb(iso);
    });
    async function fixture() {
      const userId = await seedUser(iso.db);
      const [doc] = await iso.db
        .insert(documents)
        .values({
          userId,
          source: "import",
          title: "Original title",
          fileKey: `test/${randomUUID()}.pdf`,
          fileMime: "application/pdf",
          fileRevision: "revision-a",
        })
        .returning();
      const [config] = await iso.db
        .insert(llmConfigs)
        .values({
          userId,
          provider: "openai",
          model: "test-model",
          apiKeyEncrypted: encryptSecret("test-credential-a"),
          purpose: "translation",
          isDefault: false,
        })
        .returning();
      const [credential] = await iso.db
        .insert(llmCredentialVersions)
        .values({
          userId,
          configId: config!.id,
          apiKeyEncrypted: config!.apiKeyEncrypted,
        })
        .returning();
      await iso.db
        .insert(userTranslationSettings)
        .values({
          userId,
          llmConfigId: config!.id,
          credentialVersionId: credential!.id,
        });
      const segmentId = randomUUID();
      await iso.db.insert(pdfSegments).values({
        id: segmentId,
        userId,
        documentId: doc!.id,
        fileRevision: "revision-a",
        parserVersion: "test",
        pageIndex: 0,
        ordinal: 0,
        sourceText: "The treatment did not improve the score by 20%.",
        textHash: "text-a",
        rects: [
          [
            { x: 10, y: 10 },
            { x: 50, y: 10 },
            { x: 50, y: 20 },
            { x: 10, y: 20 },
          ],
        ],
        qualityState: "reliable",
      });
      return {
        userId,
        doc: doc!,
        config: config!,
        credential: credential!,
        segmentId,
      };
    }
    const input = (
      f: Awaited<ReturnType<typeof fixture>>,
      idempotencyKey = randomUUID(),
    ) => ({
      segmentId: f.segmentId,
      fileRevision: "revision-a",
      idempotencyKey,
    });
    async function carrier(id: string) {
      const [task] = await iso.db
        .select()
        .from(pdfTranslationJobs)
        .where(eq(pdfTranslationJobs.id, id));
      const [job] = await iso.db
        .select()
        .from(jobs)
        .where(eq(jobs.id, task!.jobId));
      return job!;
    }
    function success() {
      model.mockReset();
      model.mockResolvedValue({
        status: "succeeded",
        text: "该治疗未使分数提高 20%。",
        usageStatus: "known",
        inputTokens: 20,
        outputTokens: 12,
        totalTokens: 32,
      });
    }
    it("two tabs share one carrier/model call; cache survives model deletion/title edits", async () => {
      const f = await fixture();
      success();
      const [a, b] = await Promise.all([
        requestSegmentTranslation(f.userId, f.doc.id, input(f)),
        requestSegmentTranslation(f.userId, f.doc.id, input(f)),
      ]);
      expect(a.job!.id).toBe(b.job!.id);
      const job = await carrier(a.job!.id);
      await Promise.all([
        processPdfTranslation(job),
        processPdfTranslation(job),
      ]);
      expect(model).toHaveBeenCalledTimes(1);
      await deleteTranslationSettings(f.userId);
      await iso.db
        .update(documents)
        .set({ title: "Changed title" })
        .where(eq(documents.id, f.doc.id));
      const cached = await requestSegmentTranslation(
        f.userId,
        f.doc.id,
        input(f),
      );
      expect(cached.cacheHit).toBe(true);
      expect(cached.requestUsage).toBe(0);
      expect(cached.translation!.translatedText).toContain("未");
      expect(model).toHaveBeenCalledTimes(1);
    });
    it("aliases remain idempotent after terminal regenerate; changed payload conflicts", async () => {
      const f = await fixture();
      success();
      const originalInput = input(f);
      const a = await requestSegmentTranslation(
        f.userId,
        f.doc.id,
        originalInput,
      );
      await processPdfTranslation(await carrier(a.job!.id));
      const saved = await requestSegmentTranslation(
        f.userId,
        f.doc.id,
        input(f),
      );
      const keyA = randomUUID(),
        keyB = randomUUID();
      const [r1, r2] = await Promise.all([
        regenerateTranslation(f.userId, f.doc.id, saved.translation!.id, keyA),
        regenerateTranslation(f.userId, f.doc.id, saved.translation!.id, keyB),
      ]);
      expect(r1.job!.id).toBe(r2.job!.id);
      await processPdfTranslation(await carrier(r1.job!.id));
      const replay = await regenerateTranslation(
        f.userId,
        f.doc.id,
        saved.translation!.id,
        keyB,
      );
      expect(replay.job!.id).toBe(r1.job!.id);
      expect(model).toHaveBeenCalledTimes(2);
      await expect(
        regenerateTranslation(
          f.userId,
          f.doc.id,
          saved.translation!.id,
          originalInput.idempotencyKey,
        ),
      ).rejects.toMatchObject({ code: "PDF_TRANSLATION_REQUEST_CONFLICT" });
    });
    it("unknown is not auto-retried; explicit acknowledgement creates one new revision", async () => {
      const f = await fixture();
      model.mockReset();
      model.mockResolvedValue({
        status: "unknown",
        errorCode: "LLM_TIMEOUT",
        ...UNKNOWN_USAGE,
      });
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      await processPdfTranslation(await carrier(a.job!.id));
      const viewed = await requestSegmentTranslation(
        f.userId,
        f.doc.id,
        input(f),
      );
      expect(viewed.job!.state).toBe("unknown");
      expect(viewed.job!.usage.inputTokens).toBeNull();
      expect(model).toHaveBeenCalledTimes(1);
      await expect(
        retryTranslation(f.userId, f.doc.id, a.job!.id, {
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "PDF_TRANSLATION_UNKNOWN_ACK_REQUIRED" });
      const key = randomUUID();
      const [r1, r2] = await Promise.all([
        retryTranslation(f.userId, f.doc.id, a.job!.id, {
          idempotencyKey: key,
          acknowledgeUnknownCharge: true,
        }),
        retryTranslation(f.userId, f.doc.id, a.job!.id, {
          idempotencyKey: key,
          acknowledgeUnknownCharge: true,
        }),
      ]);
      expect(r1.job!.id).toBe(r2.job!.id);
      expect(r1.job!.id).not.toBe(a.job!.id);
    });
    it("cancel versus dispatch is exclusive and generic retry cannot reset it", async () => {
      const f = await fixture();
      success();
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      const job = await carrier(a.job!.id);
      await Promise.allSettled([
        cancelPdfTranslationCarrier(job),
        processPdfTranslation(job),
      ]);
      const state = await getTranslationJob(f.userId, f.doc.id, a.job!.id);
      if (state.state === "cancelled") expect(model).not.toHaveBeenCalled();
      else {
        expect(state.state).toBe("succeeded");
        expect(model).toHaveBeenCalledTimes(1);
      }
      await expect(retryJob(f.userId, job.id)).rejects.toMatchObject({
        code: "JOB_NOT_RETRYABLE",
      });
    });
    it("recovery after dispatched becomes unknown and never calls provider", async () => {
      const f = await fixture();
      success();
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      const job = await carrier(a.job!.id);
      const old = new Date(0);
      await iso.db
        .update(jobs)
        .set({ status: "running", updatedAt: old })
        .where(eq(jobs.id, job.id));
      await iso.db
        .update(pdfTranslationJobs)
        .set({
          state: "dispatched",
          dispatchedAt: old,
          executionToken: randomUUID(),
        })
        .where(eq(pdfTranslationJobs.id, a.job!.id));
      await recoverPdfTranslationCarriers(new Date(), new Date());
      await processPdfTranslation(job);
      expect(model).not.toHaveBeenCalled();
      expect(
        (await getTranslationJob(f.userId, f.doc.id, a.job!.id)).state,
      ).toBe("unknown");
    });
    it("credential rotation pins submitted version and revoked credential prevents dispatch", async () => {
      const f = await fixture();
      success();
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      const [next] = await iso.db
        .insert(llmCredentialVersions)
        .values({
          userId: f.userId,
          configId: f.config.id,
          apiKeyEncrypted: encryptSecret("test-credential-b"),
        })
        .returning();
      await iso.db
        .update(userTranslationSettings)
        .set({ credentialVersionId: next!.id })
        .where(eq(userTranslationSettings.userId, f.userId));
      await processPdfTranslation(await carrier(a.job!.id));
      expect(model.mock.calls[0]![1]).toBe("test-credential-a");
      const g = await fixture();
      success();
      const b = await requestSegmentTranslation(g.userId, g.doc.id, input(g));
      await deleteTranslationSettings(g.userId);
      await processPdfTranslation(await carrier(b.job!.id));
      expect(model).not.toHaveBeenCalled();
      expect(
        (await getTranslationJob(g.userId, g.doc.id, b.job!.id)).state,
      ).toBe("failed");
    });
    it("tenant and stale-file boundaries forbid reads/generation", async () => {
      const f = await fixture();
      const other = await seedUser(iso.db);
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      await expect(
        getTranslationJob(other, f.doc.id, a.job!.id),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
      await iso.db
        .update(documents)
        .set({ fileRevision: "revision-b" })
        .where(eq(documents.id, f.doc.id));
      await expect(
        requestSegmentTranslation(f.userId, f.doc.id, input(f)),
      ).rejects.toMatchObject({ code: "PDF_VERSION_CONFLICT" });
      await expect(
        getTranslationJob(f.userId, f.doc.id, a.job!.id),
      ).rejects.toMatchObject({ code: "PDF_VERSION_CONFLICT" });
    });
    it("deleting during provider request prevents result commit; pre-dispatch deletion cancels", async () => {
      const f = await fixture();
      let release!: (
        r: Awaited<ReturnType<typeof completeTranslation>>,
      ) => void;
      let started!: () => void;
      const ready = new Promise<void>((r) => {
        started = r;
      });
      model.mockReset();
      model.mockImplementation(() => {
        started();
        return new Promise((r) => {
          release = r;
        });
      });
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      const running = processPdfTranslation(await carrier(a.job!.id));
      await ready;
      await iso.db.transaction(async (tx) => {
        await tx
          .select()
          .from(documents)
          .where(eq(documents.id, f.doc.id))
          .for("update");
        await cancelUndispatchedDocumentTranslations(tx, f.userId, f.doc.id);
        await tx
          .update(documents)
          .set({ deletedAt: new Date() })
          .where(eq(documents.id, f.doc.id));
      });
      release({ status: "succeeded", text: "不应保存", ...UNKNOWN_USAGE });
      await running;
      expect(
        await iso.db
          .select()
          .from(pdfTranslations)
          .where(eq(pdfTranslations.documentId, f.doc.id)),
      ).toHaveLength(0);
      await expect(
        getTranslationJob(f.userId, f.doc.id, a.job!.id),
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
      const g = await fixture();
      success();
      const b = await requestSegmentTranslation(g.userId, g.doc.id, input(g));
      await iso.db.transaction(async (tx) => {
        await tx
          .select()
          .from(documents)
          .where(eq(documents.id, g.doc.id))
          .for("update");
        await cancelUndispatchedDocumentTranslations(tx, g.userId, g.doc.id);
        await tx
          .update(documents)
          .set({ deletedAt: new Date() })
          .where(eq(documents.id, g.doc.id));
      });
      await processPdfTranslation(await carrier(b.job!.id));
      expect(model).not.toHaveBeenCalled();
    });
    it("failed regeneration preserves previous translation and failure never auto-generates", async () => {
      const f = await fixture();
      success();
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      await processPdfTranslation(await carrier(a.job!.id));
      const saved = await requestSegmentTranslation(
        f.userId,
        f.doc.id,
        input(f),
      );
      model.mockResolvedValue({
        status: "failed",
        errorCode: "LLM_OUTPUT_TRUNCATED",
        usageStatus: "partial",
        inputTokens: 10,
        outputTokens: null,
        totalTokens: null,
      });
      const again = await regenerateTranslation(
        f.userId,
        f.doc.id,
        saved.translation!.id,
        randomUUID(),
      );
      await processPdfTranslation(await carrier(again.job!.id));
      const viewed = await requestSegmentTranslation(
        f.userId,
        f.doc.id,
        input(f),
      );
      expect(viewed.translation!.id).toBe(saved.translation!.id);
      expect(model).toHaveBeenCalledTimes(2);
      const task = await getTranslationJob(f.userId, f.doc.id, again.job!.id);
      expect(task.usage).toMatchObject({
        usageStatus: "partial",
        inputTokens: 10,
        outputTokens: null,
      });
    });
    it("index parser failure retains authoritative metadata and permits explicit selection", async () => {
      const f = await fixture();
      await iso.db
        .update(documents)
        .set({ fileRevision: null })
        .where(eq(documents.id, f.doc.id));
      const page = await getPdfSegments(f.userId, f.doc.id, 0);
      expect(page.state).toBe("failed");
      expect(page.geometry?.width).toBe(100);
      expect(page.fileRevision).toHaveLength(64);
      const selected = await requestSelectionTranslation(f.userId, f.doc.id, {
        pageIndex: 0,
        fileRevision: page.fileRevision,
        idempotencyKey: randomUUID(),
        text: "Explicit selected source",
        rects: [
          [
            { x: 10, y: 10 },
            { x: 50, y: 10 },
            { x: 50, y: 20 },
            { x: 10, y: 20 },
          ],
        ],
      });
      expect(selected.job?.state).toBe("queued");
    });
    it("full selection reuses paragraph cache with PDFium corner ordering and baseline differences", async () => {
      const f = await fixture();
      success();
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      await processPdfTranslation(await carrier(a.job!.id));
      const { pdfSegmentPages } = await import("../../db/schema.js");
      await iso.db
        .insert(pdfSegmentPages)
        .values({
          userId: f.userId,
          documentId: f.doc.id,
          fileRevision: "revision-a",
          parserVersion: "test",
          pageIndex: 0,
          state: "ready",
          geometry: {
            coordinateVersion: "crop-local-points-v1",
            cropBox: [0, 0, 100, 100],
            rawCropBox: null,
            userUnit: 1,
            intrinsicRotation: 0,
            width: 100,
            height: 100,
          },
        });
      const selected = await requestSelectionTranslation(f.userId, f.doc.id, {
        pageIndex: 0,
        fileRevision: "revision-a",
        idempotencyKey: randomUUID(),
        text: "The treatment did not improve the score by 20%.",
        rects: [
          [
            { x: 10.5, y: 22 },
            { x: 50.5, y: 22 },
            { x: 50.5, y: 12 },
            { x: 10.5, y: 12 },
          ],
        ],
      });
      expect(selected.cacheHit).toBe(true);
      expect(model).toHaveBeenCalledTimes(1);
    });
    it("physical purge removes carrier, business task, content and translation together", async () => {
      const f = await fixture();
      success();
      const a = await requestSegmentTranslation(f.userId, f.doc.id, input(f));
      const job = await carrier(a.job!.id);
      await processPdfTranslation(job);
      await iso.db.transaction(async (tx) => {
        await deleteDocumentTranslationCarriers(tx, f.userId, f.doc.id);
        await tx.delete(documents).where(eq(documents.id, f.doc.id));
      });
      expect(
        await iso.db.select().from(jobs).where(eq(jobs.id, job.id)),
      ).toHaveLength(0);
      expect(
        await iso.db
          .select()
          .from(pdfTranslationJobs)
          .where(eq(pdfTranslationJobs.documentId, f.doc.id)),
      ).toHaveLength(0);
      expect(
        await iso.db
          .select()
          .from(pdfTranslationContents)
          .where(eq(pdfTranslationContents.documentId, f.doc.id)),
      ).toHaveLength(0);
      expect(
        await iso.db
          .select()
          .from(pdfTranslations)
          .where(eq(pdfTranslations.documentId, f.doc.id)),
      ).toHaveLength(0);
    });
  },
);
