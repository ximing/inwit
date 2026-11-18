import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { hash } from "argon2";
import { it, vi, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../../app.js";
import { setupIsolatedDb, teardownIsolatedDb } from "../../testkit/context.js";
import {
  documents,
  users,
  llmConfigs,
  llmCredentialVersions,
  userTranslationSettings,
  jobs,
} from "../../db/schema.js";
import { encryptSecret } from "../../llm/crypto.js";
import { processPdfTranslation } from "./processor.js";
const state = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../llm/translation-call.js", () => ({
  completeTranslation: vi.fn(async () => {
    state.calls++;
    await new Promise((r) => setTimeout(r, 200));
    return {
      status: "succeeded",
      text: "【本地验收模拟译文】该实验未使准确率提高 20%。数字、否定与引用用于检查展示。".repeat(
        15,
      ),
      usageStatus: "unknown",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }),
}));
vi.mock("../../storage/client.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../storage/client.js")>();
  return {
    ...actual,
    isStorageConfigured: () => true,
    presignGet: async () => "/api/__pdf-test/source",
    getObjectToFile: async (_key: string, dest: string) => {
      await writeFile(
        dest,
        await readFile(
          path.resolve(
            "../../scripts/pdf-translation-validation/samples/bert.pdf",
          ),
        ),
      );
    },
  };
});
it.skipIf(process.env.PDF_TRANSLATION_BROWSER_TEST !== "1")(
  "local browser fixture: real API/PostgreSQL/PDF, fake provider/storage",
  async () => {
    const iso = await setupIsolatedDb();
    const app = await buildApp();
    let stop!: () => void;
    const done = new Promise<void>((r) => {
      stop = r;
    });
    const [user] = await iso.db
      .insert(users)
      .values({
        email: "pdf-browser@test.local",
        passwordHash: await hash("PdfBrowser-test-2026"),
        displayName: "PDF 本地验收",
      })
      .returning();
    const [doc] = await iso.db
      .insert(documents)
      .values({
        userId: user!.id,
        title: "BERT · PDF 本地验收",
        source: "import",
        status: "digested",
        fileMime: "application/pdf",
        fileKey: "fixture/bert.pdf",
        pageCount: 16,
        contentJson: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "BERT paper browser fixture." }],
            },
          ],
        },
      })
      .returning();
    await iso.db
      .update(documents)
      .set({ fileKey: `docs/${user!.id}/${doc!.id}/source.pdf` })
      .where(eq(documents.id, doc!.id));
    const [config] = await iso.db
      .insert(llmConfigs)
      .values({
        userId: user!.id,
        provider: "openai",
        model: "fixture-only",
        apiKeyEncrypted: encryptSecret("fake-browser-fixture"),
        purpose: "translation",
        isDefault: false,
      })
      .returning();
    const [cred] = await iso.db
      .insert(llmCredentialVersions)
      .values({
        userId: user!.id,
        configId: config!.id,
        apiKeyEncrypted: config!.apiKeyEncrypted,
      })
      .returning();
    await iso.db
      .insert(userTranslationSettings)
      .values({
        userId: user!.id,
        llmConfigId: config!.id,
        credentialVersionId: cred!.id,
      });
    app.get("/api/__pdf-test/source", async (_req, reply) =>
      reply
        .type("application/pdf")
        .send(
          await readFile(
            path.resolve(
              "../../scripts/pdf-translation-validation/samples/bert.pdf",
            ),
          ),
        ),
    );
    app.get("/api/__pdf-test/state", async () => ({
      calls: state.calls,
      documentId: doc!.id,
      userId: user!.id,
    }));
    app.post("/api/__pdf-test/stop", async () => {
      stop();
      return { ok: true };
    });
    await app.listen({ host: "127.0.0.1", port: 3020 });
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        const pending = await iso.db
          .select()
          .from(jobs)
          .where(
            and(
              eq(jobs.userId, user!.id),
              eq(jobs.type, "pdf_translate"),
              eq(jobs.status, "pending"),
            ),
          );
        for (const job of pending) {
          await iso.db
            .update(jobs)
            .set({ status: "running" })
            .where(eq(jobs.id, job.id));
          await processPdfTranslation(job);
        }
      })().finally(() => {
        busy = false;
      });
    }, 100);
    console.log(
      "PDF_BROWSER_FIXTURE_READY",
      JSON.stringify({ documentId: doc!.id, email: user!.email }),
    );
    try {
      await done;
      expect(true).toBe(true);
    } finally {
      clearInterval(timer);
      await app.close();
      await teardownIsolatedDb(iso);
    }
  },
  1800000,
);
