import { readFile, writeFile } from "node:fs/promises";
import { it, vi } from "vitest";
vi.mock("../../apps/server/src/net/public-url.js", async (original) => ({
  ...(await original<
    typeof import("../../apps/server/src/net/public-url.js")
  >()),
  assertResolvedPublic: vi
    .fn()
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("../../apps/server/src/storage/client.js", async (original) => ({
  ...(await original<
    typeof import("../../apps/server/src/storage/client.js")
  >()),
  isStorageConfigured: () => true,
  presignGet: async () => "/api/__stream-test/source",
  getObjectToFile: async (_key: string, dest: string) => {
    await writeFile(dest, await readFile(process.env.PDF_STREAM_SAMPLE!));
  },
}));
import {
  connectIsolatedDb,
  closeIsolatedDb,
} from "../../apps/server/src/testkit/isolated-db.js";
import { setDb } from "../../apps/server/src/db/index.js";
import { buildApp } from "../../apps/server/src/app.js";
import { processDueJobs, drainJobs } from "../../apps/server/src/jobs/queue.js";
const role = process.env.PDF_STREAM_TEST_ROLE;
it.skipIf(!role)(
  "separate API/worker process",
  async () => {
    if (
      process.env.PG_HOST !== "127.0.0.1" ||
      !process.env.PDF_STREAM_TEST_SCHEMA?.startsWith("pdf_stream_")
    )
      throw Error("unsafe test environment");
    const iso = connectIsolatedDb(process.env.PDF_STREAM_TEST_SCHEMA!);
    setDb(iso.db);
    let stop!: () => void;
    const done = new Promise<void>((resolve) => {
      stop = resolve;
    });
    process.on("SIGTERM", stop);
    if (role === "api") {
      const app = await buildApp();
      app.get("/api/__stream-test/source", async (_req, reply) =>
        reply
          .type("application/pdf")
          .send(await readFile(process.env.PDF_STREAM_SAMPLE!)),
      );
      await app.listen({ host: "127.0.0.1", port: 0 });
      await writeFile(
        process.env.PDF_STREAM_READY!,
        JSON.stringify({ pid: process.pid, address: app.server.address() }),
      );
      await done;
      await app.close();
    } else {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.startsWith("https://api.example.com/"))
          throw Error("unexpected network access: " + new URL(url).hostname);
        return originalFetch(
          process.env.PDF_STREAM_PROVIDER! + new URL(url).pathname,
          init,
        );
      };
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        void processDueJobs().finally(() => {
          busy = false;
        });
      }, 50);
      await writeFile(
        process.env.PDF_STREAM_READY!,
        JSON.stringify({ pid: process.pid }),
      );
      await done;
      clearInterval(timer);
      await drainJobs();
      globalThis.fetch = originalFetch;
    }
    setDb(null);
    await closeIsolatedDb(iso);
  },
  1800000,
);
