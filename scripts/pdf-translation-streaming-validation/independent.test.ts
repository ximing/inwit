import { get as httpGet, createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "../../apps/server/node_modules/vitest/dist/index.js";
import { hash } from "../../apps/server/node_modules/argon2/argon2.cjs";
import { eq } from "../../apps/server/node_modules/drizzle-orm/index.js";
import {
  createIsolatedDb,
  closeIsolatedDb,
  dropIsolatedDb,
  type IsolatedDb,
} from "../../apps/server/src/testkit/isolated-db.js";
import { buildApp } from "../../apps/server/src/app.js";
import { setDb, pool } from "../../apps/server/src/db/index.js";
import {
  documents,
  pdfSegments,
  llmConfigs,
  llmCredentialVersions,
  userTranslationSettings,
  pdfTranslationJobs,
  pdfTranslationContents,
  jobs,
} from "../../apps/server/src/db/schema.js";
import { seedUser } from "../../apps/server/src/testkit/fixtures.js";
import { encryptSecret } from "../../apps/server/src/llm/crypto.js";
import { signAccessToken } from "../../apps/server/src/auth/token.js";
import { writeTranslationDraft } from "../../apps/server/src/documents/translation/translation-draft.js";
import { recoverPdfTranslationCarriers } from "../../apps/server/src/jobs/pdf-translation-lifecycle.js";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms;
  let last: T;
  do {
    last = await fn();
    if (ok(last)) return last;
    await pause(30);
  } while (Date.now() < end);
  throw Error("condition timed out: " + JSON.stringify(last!));
}
const evidence: Record<string, unknown> = {};
let iso: IsolatedDb,
  dir: string,
  apiBase: string,
  worker: ChildProcess,
  providerBase: string;
const streamControllers: AbortController[] = [];
const children: ChildProcess[] = [];
const calls = new Map<string, number>();
let stopHold!: () => void;
const holdDone = new Promise<void>((r) => {
  stopHold = r;
});
const provider = createServer(async (req, res) => {
  if (req.url === "/state") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        calls: Object.fromEntries(calls),
        total: [...calls.values()].reduce((a, b) => a + b, 0),
      }),
    );
    return;
  }
  if (req.url === "/stop" && req.method === "POST") {
    stopHold();
    res.end("ok");
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const payload = JSON.parse(raw);
  const text = JSON.parse(payload.messages.at(-1).content).target as string;
  const mode = text.split(" ")[0]!;
  calls.set(mode, (calls.get(mode) ?? 0) + 1);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (delta: string, finish: string | null = null) =>
    res.write(
      "data: " +
        JSON.stringify({
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "gpt-4o-mini",
          choices: [
            { index: 0, delta: { content: delta }, finish_reason: finish },
          ],
        }) +
        "\n\n",
    );
  send("第一部分");
  await pause(700);
  if (res.destroyed) return;
  send("，第二部分");
  await pause(
    mode === "crash"
      ? 15000
      : mode === "silent"
        ? 4000
        : process.env.PDF_STREAM_HOLD === "1"
          ? 2500
          : 700,
  );
  if (res.destroyed) return;
  send("。", mode === "truncated" ? "length" : "stop");
  res.write(
    "data: " +
      JSON.stringify({
        id: "fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-4o-mini",
        choices: [],
        usage: { prompt_tokens: 19, completion_tokens: 8, total_tokens: 27 },
      }) +
      "\n\n",
  );
  res.end("data: [DONE]\n\n");
});
async function launch(role: "api" | "worker") {
  const ready = path.join(dir, role + "-" + randomUUID() + ".json");
  const child = spawn(
    process.execPath,
    [
      "apps/server/node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "scripts/pdf-translation-streaming-validation/vitest.config.ts",
      "scripts/pdf-translation-streaming-validation/process.test.ts",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PDF_STREAM_TEST_ROLE: role,
        PDF_STREAM_TEST_SCHEMA: iso.schemaName,
        PDF_STREAM_READY: ready,
        PDF_STREAM_PROVIDER: providerBase,
        PDF_STREAM_SAMPLE: path.resolve(
          "scripts/pdf-translation-validation/samples/bert.pdf",
        ),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  children.push(child);
  let output = "";
  child.stdout?.on("data", (x) => {
    output += x;
  });
  child.stderr?.on("data", (x) => {
    output += x;
  });
  const state = await until(
    async () => {
      try {
        return JSON.parse(await readFile(ready, "utf8"));
      } catch {
        if (child.exitCode !== null) throw Error(output);
        return null;
      }
    },
    Boolean,
    30000,
  );
  evidence[role + "Pid"] = state.pid;
  return { child, state };
}
async function fixture(mode: string) {
  const userId = await seedUser(iso.db);
  const [doc] = await iso.db
    .insert(documents)
    .values({
      userId,
      source: "import",
      fileKey: "test/" + randomUUID() + ".pdf",
      fileMime: "application/pdf",
      fileRevision: "revision-a",
    })
    .returning();
  const [config] = await iso.db
    .insert(llmConfigs)
    .values({
      userId,
      provider: "openai",
      model: "gpt-4o-mini",
      baseUrl: "https://api.example.com/v1",
      apiKeyEncrypted: encryptSecret("fake-stream-key"),
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
  await iso.db.insert(userTranslationSettings).values({
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
    sourceText: mode + " experiment did not improve accuracy.",
    textHash: mode,
    rects: [
      [
        { x: 1, y: 1 },
        { x: 90, y: 1 },
        { x: 90, y: 12 },
        { x: 1, y: 12 },
      ],
    ],
    qualityState: "reliable",
  });
  return {
    userId,
    docId: doc!.id,
    segmentId,
    headers: { authorization: "Bearer " + signAccessToken(userId, 0) },
  };
}
async function request(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await fetch(
    apiBase + "/api/documents/" + f.docId + "/translations",
    {
      method: "POST",
      headers: { ...f.headers, "content-type": "application/json" },
      body: JSON.stringify({
        segmentId: f.segmentId,
        fileRevision: "revision-a",
        idempotencyKey: randomUUID(),
      }),
    },
  );
  const data = await response.json();
  expect(response.status, JSON.stringify(data)).toBe(202);
  return data;
}
async function stream(f: Awaited<ReturnType<typeof fixture>>, jobId: string) {
  const controller = new AbortController();
  streamControllers.push(controller);
  const response = await fetch(
    apiBase + `/api/documents/${f.docId}/translation-jobs/${jobId}/stream`,
    { headers: f.headers, signal: controller.signal },
  );
  expect(response.status).toBe(200);
  const events: { event: string; data: any; time: number }[] = [];
  const complete = (async () => {
    let buffer = "";
    const decoder = new TextDecoder();
    try {
      for await (const chunk of response.body!) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const data = frame.split("\n").find((x) => x.startsWith("data:"));
          if (data)
            events.push({
              event:
                frame
                  .split("\n")
                  .find((x) => x.startsWith("event:"))
                  ?.slice(6)
                  .trim() ?? "message",
              data: JSON.parse(data.slice(5)),
              time: Date.now(),
            });
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  return { events, close: () => controller.abort(), complete };
}
const terminal = (x: any) =>
  ["succeeded", "failed", "unknown", "cancelled"].includes(x?.state);
describe.skipIf(!!process.env.PDF_STREAM_TEST_ROLE)(
  "independent API / worker / PostgreSQL streaming",
  () => {
    beforeAll(async () => {
      if (
        process.env.PG_HOST !== "127.0.0.1" ||
        process.env.PG_PORT !== "55439" ||
        process.env.PG_DATABASE !== "inwit_pdf_local"
      )
        throw Error("explicit local PG required");
      dir = await mkdtemp(path.join(tmpdir(), "inwit-pdf-stream-"));
      iso = await createIsolatedDb("pdf_stream");
      setDb(iso.db);
      await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
      providerBase = "http://127.0.0.1:" + (provider.address() as any).port;
      const api = await launch("api");
      apiBase = "http://127.0.0.1:" + api.state.address.port;
      worker = (await launch("worker")).child;
      if (process.env.PDF_STREAM_HOLD === "1") {
        const f = await fixture("browser");
        const { users } = await import("../../apps/server/src/db/schema.js");
        await iso.db
          .update(users)
          .set({
            email: "pdf-stream-browser@test.local",
            passwordHash: await hash("StreamBrowser-local-2026"),
          })
          .where(eq(users.id, f.userId));
        const bytes = await readFile(
          "scripts/pdf-translation-validation/samples/bert.pdf",
        );
        await iso.db
          .delete(pdfSegments)
          .where(eq(pdfSegments.documentId, f.docId));
        await iso.db
          .update(documents)
          .set({
            title: "BERT · 流式独立验收",
            status: "digested",
            fileKey: `docs/${f.userId}/${f.docId}/source.pdf`,
            contentJson: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "BERT streaming fixture." }],
                },
              ],
            },
            fileRevision: createHash("sha256").update(bytes).digest("hex"),
            pageCount: 16,
          })
          .where(eq(documents.id, f.docId));
        const fileResponse = await fetch(
          apiBase + `/api/documents/${f.docId}/file`,
          { headers: f.headers },
        );
        expect(fileResponse.status).toBe(200);
        const fileMeta = await fileResponse.json();
        const rawResponse = await fetch(new URL(fileMeta.url, apiBase));
        expect(rawResponse.status).toBe(200);
        expect((await rawResponse.arrayBuffer()).byteLength).toBe(
          bytes.byteLength,
        );
        const paragraphResponse = await fetch(
          apiBase + `/api/documents/${f.docId}/pdf-segments?pageIndex=0`,
          { headers: f.headers },
        );
        expect(paragraphResponse.status).toBe(200);
        const paragraphPage = await paragraphResponse.json();
        expect(paragraphPage.state).toBe("ready");
        expect(paragraphPage.segments.length).toBeGreaterThan(0);
        await writeFile(
          "scripts/pdf-translation-streaming-validation/browser-ready.json",
          JSON.stringify(
            {
              apiBase,
              providerBase,
              documentId: f.docId,
              email: "pdf-stream-browser@test.local",
              password: "StreamBrowser-local-2026",
              schema: iso.schemaName,
            },
            null,
            2,
          ),
        );
        console.log("PDF_STREAM_BROWSER_READY", apiBase);
      }
    });
    afterAll(async () => {
      for (const controller of streamControllers) controller.abort();
      await pause(20);
      for (const child of children) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {}
      }
      provider.closeAllConnections();
      await new Promise<void>((r) => provider.close(() => r()));
      if (iso) {
        setDb(null);
        await closeIsolatedDb(iso);
        await dropIsolatedDb(iso.schemaName);
        evidence.schemaCleaned = true;
      }
      await writeFile(
        process.env.PDF_STREAM_HOLD === "1"
          ? "scripts/pdf-translation-streaming-validation/browser-run.json"
          : (process.env.PDF_STREAM_RESULT ??
              "scripts/pdf-translation-streaming-validation/results.json"),
        JSON.stringify(evidence, null, 2),
      );
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    it.skipIf(process.env.PDF_STREAM_HOLD !== "1")(
      "browser hold",
      async () => {
        await holdDone;
      },
      1800000,
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "first text precedes terminal across processes, two tabs share one call, reconnect restores draft",
      async () => {
        const f = await fixture("normal");
        const [a, b] = await Promise.all([request(f), request(f)]);
        expect(a.job.id).toBe(b.job.id);
        const one = await stream(f, a.job.id),
          two = await stream(f, a.job.id);
        await until(
          async () => one.events,
          (x) => x.some((e) => e.data.draft?.text && !terminal(e.data)),
        );
        const first = one.events.find(
          (e) => e.data.draft?.text && !terminal(e.data),
        )!;
        one.close();
        await one.complete;
        const reconnect = await stream(f, a.job.id);
        await until(
          async () => reconnect.events,
          (x) => x.some((e) => terminal(e.data)),
        );
        const end = reconnect.events.find((e) => terminal(e.data))!;
        expect(end.data.state).toBe("succeeded");
        expect(end.data.usage).toMatchObject({
          usageStatus: "known",
          inputTokens: 19,
          outputTokens: 8,
          totalTokens: 27,
        });
        expect(first.time).toBeLessThan(end.time);
        expect(calls.get("normal")).toBe(1);
        const texts = two.events.filter((e) => e.data.draft?.text);
        expect(texts.length).toBeGreaterThan(0);
        two.close();
        reconnect.close();
        await Promise.all([two.complete, reconnect.complete]);
        evidence.firstTextBeforeTerminalMs = end.time - first.time;
        evidence.normalProviderCalls = calls.get("normal");
        evidence.reconnect = true;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "truncated partial is visible but never becomes a cached translation",
      async () => {
        const f = await fixture("truncated"),
          a = await request(f),
          s = await stream(f, a.job.id);
        await until(
          async () => s.events,
          (x) => x.some((e) => terminal(e.data)),
        );
        const last = s.events.find((e) => terminal(e.data))!.data;
        expect(last.state).toBe("failed");
        expect(last.errorCode).toBe("LLM_OUTPUT_TRUNCATED");
        expect(last.draft?.text).toContain("第一部分");
        const [content] = await iso.db
          .select()
          .from(pdfTranslationContents)
          .where(eq(pdfTranslationContents.documentId, f.docId));
        expect(content!.currentTranslationId).toBeNull();
        s.close();
        await s.complete;
        evidence.truncatedNotCached = true;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "cross-user stream is rejected and an open stream stops after document soft deletion",
      async () => {
        const f = await fixture("deleted"),
          other = await fixture("other"),
          a = await request(f);
        const forbidden = await fetch(
          apiBase +
            `/api/documents/${f.docId}/translation-jobs/${a.job.id}/stream`,
          { headers: other.headers },
        );
        expect(forbidden.status).toBe(404);
        const s = await stream(f, a.job.id);
        await until(
          async () => s.events,
          (x) => x.some((e) => e.data.draft?.text),
        );
        await iso.db
          .update(documents)
          .set({ deletedAt: new Date() })
          .where(eq(documents.id, f.docId));
        await until(
          async () => s.events,
          (x) => x.some((e) => e.event === "error"),
        );
        expect(s.events.at(-1)!.data.code).toBe("RESOURCE_UNAVAILABLE");
        s.close();
        await s.complete;
        evidence.softDeleteStopsStream = true;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "dropped NOTIFY is repaired from the persisted snapshot",
      async () => {
        const f = await fixture("silent"),
          a = await request(f),
          s = await stream(f, a.job.id);
        await until(
          async () => s.events,
          (x) => x.some((e) => e.data.draft?.text?.includes("第二部分")),
        );
        await iso.pool.query(
          "ALTER TABLE pdf_translation_jobs DISABLE TRIGGER pdf_translation_stream_notify",
        );
        const before = Date.now();
        try {
          await iso.pool.query(
            "UPDATE pdf_translation_jobs SET draft_text=$1,draft_seq=draft_seq+1,draft_updated_at=now() WHERE id=$2",
            ["missed-notification-snapshot", a.job.id],
          );
        } finally {
          await iso.pool.query(
            "ALTER TABLE pdf_translation_jobs ENABLE TRIGGER pdf_translation_stream_notify",
          );
        }
        await until(
          async () => s.events,
          (x) =>
            x.some(
              (e) => e.data.draft?.text === "missed-notification-snapshot",
            ),
        );
        evidence.notifyLossRepairMs = Date.now() - before;
        s.close();
        await s.complete;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "stale execution token cannot publish a draft",
      async () => {
        const f = await fixture("stale"),
          a = await request(f),
          s = await stream(f, a.job.id);
        await until(
          async () => s.events,
          (x) => x.some((e) => e.data.draft?.text),
        );
        const [task] = await iso.db
          .select()
          .from(pdfTranslationJobs)
          .where(eq(pdfTranslationJobs.id, a.job.id));
        await writeTranslationDraft(
          task!,
          randomUUID(),
          "STALE-MUST-NOT-APPEAR",
        );
        const [after] = await iso.db
          .select()
          .from(pdfTranslationJobs)
          .where(eq(pdfTranslationJobs.id, a.job.id));
        expect(after!.draftText).not.toContain("STALE");
        const cancelled = await fetch(
          apiBase + `/api/jobs/${task!.jobId}/cancel`,
          { method: "POST", headers: f.headers },
        );
        expect(cancelled.status).toBe(409);
        s.close();
        await s.complete;
        evidence.staleTokenRejected = true;
        evidence.dispatchedCancelRejected = true;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "paused SSE client does not block another tab or enqueue every snapshot",
      async () => {
        const f = await fixture("slow"),
          a = await request(f),
          normal = await stream(f, a.job.id);
        await until(
          async () => normal.events,
          (x) => x.some((e) => e.data.draft?.text),
        );
        const [task] = await iso.db
          .select()
          .from(pdfTranslationJobs)
          .where(eq(pdfTranslationJobs.id, a.job.id));
        const paused = await new Promise<import("node:http").IncomingMessage>(
          (resolve, reject) => {
            const request = httpGet(
              apiBase +
                `/api/documents/${f.docId}/translation-jobs/${a.job.id}/stream`,
              { headers: f.headers },
              (response) => {
                response.pause();
                resolve(response);
              },
            );
            request.on("error", reject);
          },
        );
        for (let i = 0; i < 8; i++)
          await writeTranslationDraft(
            task!,
            task!.executionToken!,
            String(i) + ":" + "中".repeat(300000),
          );
        const read = await fetch(
          apiBase + `/api/documents/${f.docId}/translation-jobs/${a.job.id}`,
          { headers: f.headers },
        );
        expect(read.status).toBe(200);
        const snapshot = await read.json();
        expect(snapshot.draft.text.startsWith("7:")).toBe(true);
        await until(
          async () => normal.events,
          (x) => x.some((e) => e.data.draft?.text?.startsWith("7:")),
        );
        paused.destroy();
        normal.close();
        await normal.complete;
        evidence.slowClientSnapshotsWritten = 8;
        evidence.slowClientOtherTabResponsive = true;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "cancel before dispatch prevents provider call after worker restart",
      async () => {
        process.kill(-worker.pid!, "SIGKILL");
        const f = await fixture("cancelled"),
          a = await request(f);
        const [task] = await iso.db
          .select()
          .from(pdfTranslationJobs)
          .where(eq(pdfTranslationJobs.id, a.job.id));
        const response = await fetch(
          apiBase + `/api/jobs/${task!.jobId}/cancel`,
          { method: "POST", headers: f.headers },
        );
        expect(response.status).toBe(200);
        worker = (await launch("worker")).child;
        await pause(300);
        expect(calls.get("cancelled") ?? 0).toBe(0);
        evidence.cancelledProviderCalls = 0;
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "graceful close destroys active SSE and releases a delayed LISTEN client",
      async () => {
        const f = await fixture("close"),
          a = await request(f);
        const originalConnect = pool.connect.bind(pool);
        let acquired: any;
        let started!: () => void;
        const listening = new Promise<void>((r) => {
          started = r;
        });
        (pool as any).connect = async () => {
          acquired = await originalConnect();
          const originalQuery = acquired.query.bind(acquired);
          acquired.query = async (...args: any[]) => {
            if (args[0] === "LISTEN pdf_translation_changed") {
              started();
              await pause(200);
            }
            return originalQuery(...args);
          };
          return acquired;
        };
        const app = await buildApp();
        await app.listen({ host: "127.0.0.1", port: 0 });
        const local = "http://127.0.0.1:" + (app.server.address() as any).port;
        const controller = new AbortController();
        try {
          const response = await fetch(
            local +
              `/api/documents/${f.docId}/translation-jobs/${a.job.id}/stream`,
            { headers: f.headers, signal: controller.signal },
          );
          expect(response.status).toBe(200);
          await listening;
          const startedAt = Date.now();
          await Promise.race([
            app.close(),
            pause(3000).then(() => {
              throw Error("SSE blocked graceful close");
            }),
          ]);
          expect(pool.totalCount).toBe(pool.idleCount);
          evidence.gracefulCloseMs = Date.now() - startedAt;
        } finally {
          controller.abort();
          (pool as any).connect = originalConnect;
          await app.close();
        }
      },
    );
    it.skipIf(process.env.PDF_STREAM_HOLD === "1")(
      "worker crash keeps partial unknown and recovery never dispatches again",
      async () => {
        const f = await fixture("crash"),
          a = await request(f),
          s = await stream(f, a.job.id);
        await until(
          async () => s.events,
          (x) => x.some((e) => e.data.draft?.text),
        );
        process.kill(-worker.pid!, "SIGKILL");
        const [task] = await iso.db
          .select()
          .from(pdfTranslationJobs)
          .where(eq(pdfTranslationJobs.id, a.job.id));
        await iso.db
          .update(jobs)
          .set({ updatedAt: new Date(0) })
          .where(eq(jobs.id, task!.jobId));
        await iso.db
          .update(pdfTranslationJobs)
          .set({ leaseUntil: new Date(0) })
          .where(eq(pdfTranslationJobs.id, a.job.id));
        await recoverPdfTranslationCarriers(new Date(), new Date());
        await until(
          async () => s.events,
          (x) => x.some((e) => e.data.state === "unknown"),
        );
        const [content] = await iso.db
          .select()
          .from(pdfTranslationContents)
          .where(eq(pdfTranslationContents.documentId, f.docId));
        expect(content!.currentTranslationId).toBeNull();
        worker = (await launch("worker")).child;
        await pause(400);
        expect(calls.get("crash")).toBe(1);
        s.close();
        await s.complete;
        evidence.crashUnknownNoRedispatch = true;
      },
    );
  },
);
