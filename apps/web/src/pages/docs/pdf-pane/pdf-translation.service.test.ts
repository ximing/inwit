import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { PdfSegmentsPage, PdfTranslationResponse } from "@inwit/dto";
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  getJob: vi.fn(),
  getPage: vi.fn(),
  retry: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("@/api/translation.js", () => ({
  createTranslation: mock.create,
  getTranslationJob: mock.getJob,
  getPdfSegments: mock.getPage,
  retryTranslation: mock.retry,
  streamTranslationJob: mock.stream,
}));
import { PdfTranslationService } from "./pdf-translation.service.js";
const page: PdfSegmentsPage = {
  documentId: "doc",
  fileRevision: "hash",
  parserVersion: "v1",
  pageIndex: 0,
  geometry: null,
  segments: [],
  state: "ready",
  diagnostics: [],
};
const result: PdfTranslationResponse = {
  cacheHit: true,
  requestUsage: 0,
  job: null,
  translation: {
    id: "translation",
    documentId: "doc",
    fileRevision: "hash",
    pageIndex: 0,
    sourceText: "source",
    translatedText: "中文",
    generationRevision: 1,
    model: {
      provider: "openai",
      model: "test",
      baseUrl: "https://example.com",
    },
    usage: {
      usageStatus: "unknown",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    },
    createdAt: "",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.stream.mockImplementation(() =>
    Promise.reject(new Error("stream unsupported")),
  );
  vi.useFakeTimers();
  vi.stubGlobal("document", { hidden: false });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("translation view request isolation", () => {
  it("reopens saved translation without any second creation", async () => {
    const s = new PdfTranslationService();
    s.start("doc");
    s.pages = { 0: page };
    mock.create.mockResolvedValue(result);
    const target = { key: "a", segmentId: "a", pageIndex: 0, rects: [] };
    await s.open(target);
    s.close();
    await s.open(target);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(s.result?.translation?.translatedText).toBe("中文");
    s.dispose();
  });
  it("late response only warms its own cache, never changes the new anchor", async () => {
    const s = new PdfTranslationService();
    s.start("doc");
    s.pages = { 0: page };
    let resolve!: (r: PdfTranslationResponse) => void;
    mock.create
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(result);
    const old = s.open({ key: "a", segmentId: "a", pageIndex: 0, rects: [] });
    await s.open({ key: "b", segmentId: "b", pageIndex: 0, rects: [] });
    resolve(result);
    await old;
    expect(s.target?.key).toBe("b");
    expect(s.cache.a?.translation?.id).toBe("translation");
    s.dispose();
  });
  it("lost initial response retries with the same idempotency key", async () => {
    const s = new PdfTranslationService();
    s.start("doc");
    s.pages = { 0: page };
    mock.create
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(result);
    await s.open({ key: "a", segmentId: "a", pageIndex: 0, rects: [] });
    await s.retry();
    expect(mock.create.mock.calls[0]?.[1].idempotencyKey).toBe(
      mock.create.mock.calls[1]?.[1].idempotencyKey,
    );
    s.dispose();
  });
  it("drops an old file response after same-document revision changes", async () => {
    const s = new PdfTranslationService();
    s.start("doc");
    s.pages = { 0: page };
    let resolve!: (r: PdfTranslationResponse) => void;
    mock.create.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = s.open({
      key: "selection-stable",
      segmentId: "a",
      pageIndex: 0,
      rects: [],
    });
    mock.getPage.mockResolvedValue({
      ...page,
      pageIndex: 1,
      fileRevision: "new-file",
    });
    await s.loadPage(1);
    resolve(result);
    await old;
    expect(s.cache["selection-stable"]).toBeUndefined();
    expect(s.target).toBeNull();
    s.dispose();
  });
  it("drops an old page-index response after restarting the same document", async () => {
    const s = new PdfTranslationService();
    s.start("doc");
    let resolve!: (r: PdfSegmentsPage) => void;
    mock.getPage.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = s.loadPage(0);
    s.start("doc");
    resolve(page);
    await old;
    expect(s.pages[0]).toBeUndefined();
    s.dispose();
  });
  it("does not write results after disposal", async () => {
    const s = new PdfTranslationService();
    s.start("doc");
    s.pages = { 0: page };
    let resolve!: (r: PdfTranslationResponse) => void;
    mock.create.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = s.open({ key: "a", segmentId: "a", pageIndex: 0, rects: [] });
    s.dispose();
    resolve(result);
    await old;
    expect(s.result).toBeNull();
    expect(s.cache.a).toBeUndefined();
  });
});

describe("page index polling", () => {
  it("bounds failing background retries and allows explicit retry", async () => {
    mock.getPage
      .mockResolvedValueOnce({ ...page, state: "indexing" })
      .mockRejectedValue(new Error("network"));
    const s = new PdfTranslationService();
    s.start("doc");
    s.watchPage(0);
    await vi.advanceTimersByTimeAsync(30000);
    expect(mock.getPage).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(30000);
    expect(mock.getPage).toHaveBeenCalledTimes(5);
    mock.getPage.mockResolvedValueOnce(page);
    s.retryPage(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.pages[0]?.state).toBe("ready");
    expect(mock.create).not.toHaveBeenCalled();
    s.dispose();
  });
  it("recovers an indexing poll after a transient read failure", async () => {
    mock.getPage
      .mockResolvedValueOnce({ ...page, state: "indexing" })
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(page);
    const s = new PdfTranslationService();
    s.start("doc");
    s.watchPage(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.pageErrors[0]).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.pages[0]?.state).toBe("ready");
    expect(s.pageErrors[0]).toBeUndefined();
    expect(mock.getPage).toHaveBeenCalledTimes(3);
    expect(mock.create).not.toHaveBeenCalled();
    s.dispose();
  });
  it("polls a mounted indexing page until ready without any model request", async () => {
    mock.getPage
      .mockResolvedValueOnce({ ...page, state: "indexing" })
      .mockResolvedValue(page);
    const s = new PdfTranslationService();
    s.start("doc");
    s.watchPage(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mock.getPage).toHaveBeenCalledTimes(2);
    expect(s.pages[0]?.state).toBe("ready");
    await vi.advanceTimersByTimeAsync(5000);
    expect(mock.getPage).toHaveBeenCalledTimes(2);
    expect(mock.create).not.toHaveBeenCalled();
    s.dispose();
  });
  it("pauses hidden pages and cancels polling on unmount and disposal", async () => {
    const hidden = document as unknown as { hidden: boolean };
    mock.getPage.mockResolvedValue({ ...page, state: "indexing" });
    const s = new PdfTranslationService();
    s.start("doc");
    s.watchPage(0);
    await vi.advanceTimersByTimeAsync(0);
    hidden.hidden = true;
    s.visibility();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mock.getPage).toHaveBeenCalledTimes(1);
    hidden.hidden = false;
    s.visibility();
    await vi.advanceTimersByTimeAsync(0);
    expect(mock.getPage).toHaveBeenCalledTimes(2);
    s.unwatchPage(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mock.getPage).toHaveBeenCalledTimes(2);
    s.watchPage(0);
    await vi.advanceTimersByTimeAsync(0);
    s.dispose();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mock.getPage).toHaveBeenCalledTimes(3);
    expect(mock.create).not.toHaveBeenCalled();
  });
});

describe("translation streamed snapshots", () => {
  type Job = NonNullable<PdfTranslationResponse["job"]>;
  const job = (
    seq = "0",
    text = "",
    state: Job["state"] = "dispatched",
  ): Job => ({
    id: "job",
    state,
    errorCode: null,
    translation: null,
    usage: null,
    canCancel: false,
    fileRevision: "hash",
    generationRevision: 2,
    draft: { streamId: "stream", seq, text, updatedAt: "" },
  });
  const target = { key: "a", segmentId: "a", pageIndex: 0, rects: [] };
  const setup = async () => {
    let emit!: (j: Job) => void;
    let finish!: () => void;
    let signal!: AbortSignal;
    mock.stream.mockImplementation((_id, _job, abort, callback) => {
      signal = abort;
      emit = callback;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const s = new PdfTranslationService();
    s.start("doc");
    s.pages = { 0: page };
    mock.create.mockResolvedValue({ ...result, job: job(), translation: null });
    await s.open(target);
    return { s, emit, finish, signal };
  };
  it("coalesces snapshots, discards lower seq and accepts a same-seq terminal only once", async () => {
    const { s, emit } = await setup();
    emit(job("2", "第一段"));
    emit(job("1", "旧"));
    expect(s.result?.job?.draft?.text).toBe("");
    await vi.advanceTimersByTimeAsync(100);
    expect(s.result?.job?.draft?.text).toBe("第一段");
    emit({ ...job("2", "", "succeeded"), translation: result.translation });
    expect(s.result?.translation?.translatedText).toBe("中文");
    emit(job("2", "迟到"));
    await vi.advanceTimersByTimeAsync(200);
    expect(s.result?.job?.state).toBe("succeeded");
    expect(mock.create).toHaveBeenCalledTimes(1);
    s.dispose();
  });
  it("keeps the newest buffered draft when a lower-seq terminal arrives before a render", async () => {
    const { s, emit } = await setup();
    emit(job("9", "已经收到的完整部分"));
    emit(job("8", "较旧部分", "unknown"));
    expect(s.result?.job?.state).toBe("unknown");
    expect(s.result?.job?.draft?.text).toBe("已经收到的完整部分");
    s.dispose();
  });
  it("EOF falls back to read-only GET and never creates another paid job", async () => {
    const { s, finish } = await setup();
    mock.getJob.mockResolvedValue({
      ...job("3", "", "succeeded"),
      translation: result.translation,
    });
    finish();
    await vi.advanceTimersByTimeAsync(600);
    expect(mock.getJob).toHaveBeenCalledWith("doc", "job");
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(s.result?.job?.state).toBe("succeeded");
    s.dispose();
  });
  it("close aborts and reopening resumes the same job, without applying closed-view events", async () => {
    const { s, emit, signal } = await setup();
    s.close();
    expect(signal.aborted).toBe(true);
    emit(job("7", "旧视图"));
    await vi.advanceTimersByTimeAsync(100);
    expect(s.result).toBe(null);
    mock.getJob.mockResolvedValue(job("8", "继续同一任务"));
    await s.open(target);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(mock.getJob).toHaveBeenCalledWith("doc", "job");
    expect(s.result?.job?.draft?.text).toBe("继续同一任务");
    s.dispose();
  });
  it("hidden aborts; visible reconciles state before resubscribing", async () => {
    const { s, signal, emit } = await setup();
    vi.stubGlobal("document", { hidden: true });
    s.visibility();
    expect(signal.aborted).toBe(true);
    emit(job("3", "不可见旧消息"));
    await vi.advanceTimersByTimeAsync(200);
    expect(s.result?.job?.draft?.text).toBe("");
    mock.getJob.mockResolvedValue(job("4", "恢复快照"));
    vi.stubGlobal("document", { hidden: false });
    s.visibility();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.result?.job?.draft?.text).toBe("恢复快照");
    expect(mock.create).toHaveBeenCalledTimes(1);
    s.dispose();
  });
  it("keeps the old successful translation when a newer draft ends unknown", async () => {
    const { s, emit } = await setup();
    // A regenerate response may contain both the prior successful result and active new job.
    mock.getJob.mockResolvedValue({
      ...job("2", "新草稿"),
      translation: result.translation,
    });
    s.visibility();
    await vi.advanceTimersByTimeAsync(0);
    emit(job("3", "中断草稿", "unknown"));
    // visibility replaced the subscriber; exercise the current callback.
    const callback = mock.stream.mock.calls.at(-1)![3] as (j: Job) => void;
    callback(job("3", "中断草稿", "unknown"));
    expect(s.result?.translation?.translatedText).toBe("中文");
    expect(s.result?.job?.state).toBe("unknown");
    expect(s.result?.job?.draft?.text).toBe("中断草稿");
    s.dispose();
  });
  it("rejects a different file revision and stream id", async () => {
    const { s, emit } = await setup();
    emit({ ...job("2", "其他文件"), fileRevision: "replacement" });
    await vi.advanceTimersByTimeAsync(100);
    emit({
      ...job("3", "其他执行"),
      draft: { streamId: "other", seq: "3", text: "其他执行", updatedAt: "" },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(s.result?.job?.draft?.text).toBe("");
    s.dispose();
  });
});
