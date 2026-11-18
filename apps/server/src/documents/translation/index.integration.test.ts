import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { setDb } from "../../db/index.js";
import { documents, pdfSegmentPages, pdfSegments } from "../../db/schema.js";
import { isolatedDbContext } from "../../testkit/context.js";
import {
  createIsolatedDb,
  closeIsolatedDb,
  dropIsolatedDb,
  type IsolatedDb,
} from "../../testkit/isolated-db.js";
import { seedUser } from "../../testkit/fixtures.js";
import { getPdfSegments, pdfFileRevision } from "./index.service.js";
import { parsePdfPage, readPdfPageGeometry } from "./pdf-parser.js";
vi.mock("./pdf-parser.js", () => ({
  PDF_PARSER_VERSION: "index-test",
  parsePdfPage: vi.fn(),
  readPdfPageGeometry: vi.fn(),
}));
vi.mock("../../storage/client.js", () => ({
  getObjectToFile: async (_key: string, dest: string) => {
    await (await import("node:fs/promises")).writeFile(dest, "index-test-pdf");
  },
}));
const parser = vi.mocked(parsePdfPage);
const geometry = {
  coordinateVersion: "crop-local-points-v1" as const,
  cropBox: [0, 0, 100, 100] as [number, number, number, number],
  userUnit: 1,
  intrinsicRotation: 0 as const,
  width: 100,
  height: 100,
};
function result(text: string): Awaited<ReturnType<typeof parsePdfPage>> {
  return {
    pageIndex: 0,
    geometry,
    state: "ready",
    diagnostics: [],
    segments: [
      {
        id: text,
        pageIndex: 0,
        ordinal: 0,
        sourceText: text,
        textHash: text,
        rects: [
          [
            { x: 1, y: 1 },
            { x: 90, y: 1 },
            { x: 90, y: 12 },
            { x: 1, y: 12 },
          ],
        ],
        qualityState: "reliable",
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const ctx = isolatedDbContext();
describe.skipIf(!ctx.available)("persistent PDF page indexing leases", () => {
  let iso: IsolatedDb;
  beforeAll(async () => {
    iso = await createIsolatedDb("translation_index");
    setDb(iso.db);
  });
  afterAll(async () => {
    setDb(null);
    await closeIsolatedDb(iso);
    await dropIsolatedDb(iso.schemaName);
  });
  beforeEach(() => {
    parser.mockReset();
    vi.mocked(readPdfPageGeometry).mockReset();
  });
  async function fixture() {
    const userId = await seedUser(iso.db);
    const [doc] = await iso.db
      .insert(documents)
      .values({
        userId,
        source: "import",
        fileKey: randomUUID() + ".pdf",
        fileMime: "application/pdf",
      })
      .returning();
    return { userId, documentId: doc!.id };
  }
  it("simultaneous requests share one database claim and cached result", async () => {
    const f = await fixture(),
      entered = deferred<void>(),
      release = deferred<Awaited<ReturnType<typeof parsePdfPage>>>();
    parser.mockImplementation(async () => {
      entered.resolve();
      return release.promise;
    });
    const first = getPdfSegments(f.userId, f.documentId, 0);
    await entered.promise;
    const competitors = await Promise.all(
      Array.from({ length: 8 }, () =>
        getPdfSegments(f.userId, f.documentId, 0),
      ),
    );
    expect(
      competitors.every(
        (p) => p.state === "indexing" && p.segments.length === 0,
      ),
    ).toBe(true);
    expect(parser).toHaveBeenCalledTimes(1);
    release.resolve(result("winner"));
    expect((await first).segments[0]?.sourceText).toBe("winner");
    expect((await getPdfSegments(f.userId, f.documentId, 0)).state).toBe(
      "ready",
    );
    expect(parser).toHaveBeenCalledTimes(1);
  });
  it.each(["success", "failure"] as const)(
    "expired lease recovery rejects stale %s completion",
    async (outcome) => {
      const f = await fixture(),
        entered = deferred<void>(),
        release = deferred<void>();
      parser
        .mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          if (outcome === "failure") throw new Error("late error");
          return result("stale");
        })
        .mockResolvedValueOnce(result("successor"));
      const oldRequest = getPdfSegments(f.userId, f.documentId, 0);
      await entered.promise;
      const [oldPage] = await iso.db
        .select()
        .from(pdfSegmentPages)
        .where(eq(pdfSegmentPages.documentId, f.documentId));
      await iso.db
        .update(pdfSegmentPages)
        .set({ updatedAt: new Date(0) })
        .where(eq(pdfSegmentPages.id, oldPage!.id));
      expect(
        (await getPdfSegments(f.userId, f.documentId, 0)).segments[0]
          ?.sourceText,
      ).toBe("successor");
      const [newPage] = await iso.db
        .select()
        .from(pdfSegmentPages)
        .where(eq(pdfSegmentPages.documentId, f.documentId));
      expect(newPage!.id).not.toBe(oldPage!.id);
      release.resolve();
      expect((await oldRequest).segments[0]?.sourceText).toBe("successor");
      const stored = await iso.db
        .select()
        .from(pdfSegments)
        .where(eq(pdfSegments.documentId, f.documentId));
      expect(stored.map((s) => s.sourceText)).toEqual(["successor"]);
      expect(parser).toHaveBeenCalledTimes(2);
    },
  );
  it("a different process can recover a persisted orphan lease", async () => {
    const f = await fixture(),
      revision = pdfFileRevision(new TextEncoder().encode("index-test-pdf"));
    await iso.db
      .update(documents)
      .set({ fileRevision: revision })
      .where(eq(documents.id, f.documentId));
    const orphan = randomUUID();
    await iso.db
      .insert(pdfSegmentPages)
      .values({
        id: orphan,
        userId: f.userId,
        documentId: f.documentId,
        fileRevision: revision,
        parserVersion: "index-test",
        pageIndex: 0,
        state: "indexing",
        updatedAt: new Date(0),
      });
    parser.mockResolvedValue(result("recovered"));
    expect(
      (await getPdfSegments(f.userId, f.documentId, 0)).segments[0]?.sourceText,
    ).toBe("recovered");
    const [page] = await iso.db
      .select()
      .from(pdfSegmentPages)
      .where(eq(pdfSegmentPages.documentId, f.documentId));
    expect(page!.id).not.toBe(orphan);
    expect(page!.state).toBe("ready");
  });
  it("parser and metadata failures settle the lease without repeated extraction", async () => {
    const f = await fixture();
    parser.mockRejectedValue(new Error("invalid PDF"));
    vi.mocked(readPdfPageGeometry).mockRejectedValue(new Error("no metadata"));
    const failed = await getPdfSegments(f.userId, f.documentId, 0);
    expect(failed.state).toBe("failed");
    expect(failed.geometry).toBeNull();
    expect((await getPdfSegments(f.userId, f.documentId, 0)).state).toBe(
      "failed",
    );
    expect(parser).toHaveBeenCalledTimes(1);
  });
});
