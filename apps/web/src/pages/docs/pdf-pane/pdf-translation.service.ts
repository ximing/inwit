import { Service } from "@rabjs/react";
import type {
  PdfQuad,
  PdfSegment,
  PdfSegmentsPage,
  PdfTranslationJob,
  PdfTranslationResponse,
} from "@inwit/dto";
import * as api from "@/api/translation.js";
import { ApiError, errorMessage } from "@/api/client.js";
export type TranslationTarget = {
  key: string;
  pageIndex: number;
  segmentId?: string;
  text?: string;
  rects: PdfQuad[];
};
const active = (job: PdfTranslationJob | null) =>
  !!job && ["queued", "preparing", "dispatched"].includes(job.state);
export class PdfTranslationService extends Service {
  enabled = true;
  documentId = "";
  pages: Record<number, PdfSegmentsPage> = {};
  pageErrors: Record<number, string> = {};
  target: TranslationTarget | null = null;
  result: PdfTranslationResponse | null = null;
  error = "";
  needsSettings = false;
  busy = false;
  menu = false;
  hidden = false;
  cache: Record<string, PdfTranslationResponse> = {};
  private keys: Record<string, string> = {};
  private pendingPages = new Set<number>();
  private watchedPages = new Set<number>();
  private indexFailures = new Map<number, number>();
  private indexTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private generation = 0;
  private documentEpoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay = 500;
  private disposed = false;
  streamStatus: "idle" | "connecting" | "live" | "polling" = "idle";
  private stream: AbortController | null = null;
  private streamJobId: string | null = null;
  private streamFlush: ReturnType<typeof setTimeout> | null = null;
  private streamWatchdog: ReturnType<typeof setTimeout> | null = null;
  private pendingSnapshot: PdfTranslationJob | null = null;
  private fallbackJobId: string | null = null;
  start(id: string) {
    this.dispose();
    this.disposed = false;
    this.documentId = id;
    this.pages = {};
    this.pageErrors = {};
    this.cache = {};
    this.keys = {};
    this.fallbackJobId = null;
    try {
      this.enabled = localStorage.getItem("pdf-chinese-assistance") !== "off";
    } catch {}
  }
  dispose() {
    this.disposed = true;
    this.documentEpoch++;
    this.generation++;
    this.stopPolling();
    this.target = null;
    this.result = null;
    this.pendingPages.clear();
    this.watchedPages.clear();
    this.indexFailures.clear();
    this.stopIndexPolling();
  }
  toggle() {
    this.enabled = !this.enabled;
    try {
      localStorage.setItem(
        "pdf-chinese-assistance",
        this.enabled ? "on" : "off",
      );
    } catch {}
    if (!this.enabled) this.close();
  }
  close() {
    this.generation++;
    this.target = null;
    this.result = null;
    this.busy = false;
    this.menu = false;
    this.hidden = false;
    this.stopPolling();
  }
  private stopStream() {
    this.stream?.abort();
    this.stream = null;
    this.streamJobId = null;
    if (this.streamFlush) clearTimeout(this.streamFlush);
    if (this.streamWatchdog) clearTimeout(this.streamWatchdog);
    this.streamFlush = null;
    this.streamWatchdog = null;
    this.pendingSnapshot = null;
    this.streamStatus = "idle";
  }
  private stopPolling() {
    this.stopStream();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  watchPage(pageIndex: number) {
    this.watchedPages.add(pageIndex);
    if (!document.hidden) void this.loadPage(pageIndex);
  }
  unwatchPage(pageIndex: number) {
    this.watchedPages.delete(pageIndex);
    const timer = this.indexTimers.get(pageIndex);
    if (timer) clearTimeout(timer);
    this.indexTimers.delete(pageIndex);
  }
  private stopIndexPolling() {
    for (const timer of this.indexTimers.values()) clearTimeout(timer);
    this.indexTimers.clear();
  }
  retryPage(pageIndex: number) {
    this.indexFailures.delete(pageIndex);
    void this.loadPage(pageIndex);
  }
  private scheduleIndex(pageIndex: number, delay = 1000) {
    if (this.disposed || document.hidden || !this.watchedPages.has(pageIndex))
      return;
    const epoch = this.documentEpoch;
    const previous = this.indexTimers.get(pageIndex);
    if (previous) clearTimeout(previous);
    this.indexTimers.set(
      pageIndex,
      setTimeout(() => {
        this.indexTimers.delete(pageIndex);
        if (
          !this.disposed &&
          epoch === this.documentEpoch &&
          !document.hidden &&
          this.watchedPages.has(pageIndex)
        )
          void this.loadPage(pageIndex);
      }, delay),
    );
  }
  async loadPage(pageIndex: number) {
    if (
      !this.documentId ||
      (this.pages[pageIndex] && this.pages[pageIndex].state !== "indexing") ||
      this.pendingPages.has(pageIndex) ||
      this.disposed
    )
      return;
    const id = this.documentId,
      epoch = this.documentEpoch;
    this.pendingPages.add(pageIndex);
    try {
      const page = await api.getPdfSegments(id, pageIndex);
      if (
        this.disposed ||
        id !== this.documentId ||
        epoch !== this.documentEpoch
      )
        return;
      const old = Object.values(this.pages)[0]?.fileRevision;
      if (old && old !== page.fileRevision) {
        this.documentEpoch++;
        this.stopIndexPolling();
        this.pendingPages.clear();
        this.keys = {};
        this.cache = {};
        this.pages = {};
        this.close();
      }
      this.pages = { ...this.pages, [pageIndex]: page };
      this.indexFailures.delete(pageIndex);
      const { [pageIndex]: _oldError, ...remainingErrors } = this.pageErrors;
      this.pageErrors = remainingErrors;
      if (page.state === "indexing") this.scheduleIndex(pageIndex);
    } catch (e) {
      if (
        !this.disposed &&
        id === this.documentId &&
        epoch === this.documentEpoch
      ) {
        this.pageErrors = {
          ...this.pageErrors,
          [pageIndex]: errorMessage(e, "段落索引暂不可用，可选中文字翻译"),
        };
        const failures = (this.indexFailures.get(pageIndex) ?? 0) + 1;
        this.indexFailures.set(pageIndex, failures);
        if (this.pages[pageIndex]?.state === "indexing" && failures <= 3)
          this.scheduleIndex(pageIndex, 1000 * 2 ** (failures - 1));
      }
    } finally {
      if (epoch === this.documentEpoch) this.pendingPages.delete(pageIndex);
    }
  }
  openSegment(segment: PdfSegment) {
    if (this.target?.key === segment.id) {
      this.close();
      return;
    }
    void this.open({
      key: segment.id,
      pageIndex: segment.pageIndex,
      segmentId: segment.id,
      rects: segment.rects,
    });
  }
  async open(target: TranslationTarget) {
    this.close();
    this.target = target;
    this.error = "";
    this.needsSettings = false;
    this.result = this.cache[target.key] ?? null;
    if (this.result?.translation)
      this.result = { ...this.result, cacheHit: true, requestUsage: 0 };
    if (this.result?.translation && !active(this.result.job)) return;
    const version = this.generation,
      epoch = this.documentEpoch,
      revision = this.pages[target.pageIndex]?.fileRevision;
    const id = this.documentId;
    this.busy = true;
    this.delay = 500;
    try {
      if (this.result?.job) {
        await this.poll(version, id, target.key, this.result.job.id);
        return;
      }
      const page = this.pages[target.pageIndex];
      if (!page) throw new Error("请等待当前页段落索引准备完成");
      const key = (this.keys[target.key] ??= crypto.randomUUID());
      const response = target.segmentId
        ? await api.createTranslation(id, {
            segmentId: target.segmentId,
            fileRevision: page.fileRevision,
            idempotencyKey: key,
          })
        : await api.createSelectionTranslation(id, {
            pageIndex: target.pageIndex,
            text: target.text ?? "",
            rects: target.rects,
            fileRevision: page.fileRevision,
            idempotencyKey: key,
          });
      this.accept(response, version, id, target.key, revision, epoch);
    } catch (e) {
      this.fail(e, version, id);
    } finally {
      if (version === this.generation) this.busy = false;
    }
  }
  private accept(
    response: PdfTranslationResponse,
    version: number,
    id: string,
    key: string,
    revision: string | undefined,
    epoch: number,
  ) {
    if (
      this.disposed ||
      id !== this.documentId ||
      epoch !== this.documentEpoch ||
      revision !== Object.values(this.pages)[0]?.fileRevision ||
      (response.translation && response.translation.fileRevision !== revision)
    )
      return;
    const previous = this.cache[key];
    const incoming = response.job;
    if (incoming?.fileRevision && incoming.fileRevision !== revision) return;
    if (incoming && previous?.job?.id === incoming.id) {
      const old = previous.job;
      if (!active(old) && old.state !== incoming.state) return;
      if (old.draft && incoming.draft) {
        if (old.draft.streamId !== incoming.draft.streamId) return;
        if (BigInt(incoming.draft.seq) < BigInt(old.draft.seq)) {
          if (active(incoming)) return;
          response = { ...response, job: { ...incoming, draft: old.draft } };
        }
      }
    } else if (
      incoming &&
      previous?.job &&
      incoming.generationRevision !== undefined &&
      previous.job.generationRevision !== undefined &&
      incoming.generationRevision < previous.job.generationRevision
    )
      return;
    this.cache = { ...this.cache, [key]: response };
    if (version !== this.generation || this.target?.key !== key) return;
    this.result = response;
    this.needsSettings =
      !!response.job?.errorCode &&
      [
        "PDF_TRANSLATION_CREDENTIAL_OR_DOCUMENT_UNAVAILABLE",
        "LLM_AUTH_FAILED",
        "LLM_NOT_CONFIGURED",
      ].includes(response.job.errorCode);
    if (response.translation) {
      const page = this.pages[this.target.pageIndex];
      if (page)
        this.pages = {
          ...this.pages,
          [page.pageIndex]: {
            ...page,
            segments: page.segments.map((s) =>
              s.id === key ? { ...s, hasTranslation: true } : s,
            ),
          },
        };
    }
    if (active(response.job)) {
      if (this.fallbackJobId === response.job!.id)
        this.schedule(version, id, key, response.job!.id);
      else this.subscribe(version, id, key, response.job!.id, revision, epoch);
    } else this.stopPolling();
  }
  private subscribe(
    version: number,
    id: string,
    key: string,
    jobId: string,
    revision: string | undefined,
    epoch: number,
  ) {
    if (document.hidden || this.disposed || this.streamJobId === jobId) return;
    this.stopPolling();
    const controller = new AbortController();
    this.stream = controller;
    this.streamJobId = jobId;
    this.streamStatus = "connecting";
    const valid = () =>
      !controller.signal.aborted &&
      !this.disposed &&
      version === this.generation &&
      epoch === this.documentEpoch &&
      id === this.documentId &&
      this.target?.key === key &&
      this.cache[key]?.job?.id === jobId;
    const flush = () => {
      this.streamFlush = null;
      const job = this.pendingSnapshot;
      this.pendingSnapshot = null;
      if (!job || !valid()) return;
      this.accept(
        {
          cacheHit: false,
          requestUsage: null,
          translation: job.translation ?? this.cache[key]?.translation ?? null,
          job,
        },
        version,
        id,
        key,
        revision,
        epoch,
      );
    };
    const fallback = () => {
      if (!valid()) return;
      this.fallbackJobId = jobId;
      this.stopStream();
      this.streamStatus = "polling";
      this.schedule(version, id, key, jobId);
    };
    const watchdog = () => {
      if (this.streamWatchdog) clearTimeout(this.streamWatchdog);
      // Even a silent open connection must eventually reconcile read-only state.
      this.streamWatchdog = setTimeout(fallback, 45000);
    };
    watchdog();
    void api
      .streamTranslationJob(id, jobId, controller.signal, (job) => {
        if (!valid() || job.id !== jobId) return;
        watchdog();
        this.streamStatus = "live";
        const previous = this.pendingSnapshot ?? this.cache[key]?.job;
        if (previous?.id === job.id) {
          if (!active(previous) && previous.state !== job.state) return;
          if (previous.draft && job.draft) {
            if (previous.draft.streamId !== job.draft.streamId) return;
            if (BigInt(job.draft.seq) < BigInt(previous.draft.seq)) {
              if (active(job)) return;
              job = { ...job, draft: previous.draft };
            }
          }
        }
        this.pendingSnapshot = job;
        if (!active(job)) {
          if (this.streamFlush) clearTimeout(this.streamFlush);
          flush();
        } else if (!this.streamFlush) this.streamFlush = setTimeout(flush, 100);
      })
      .then(fallback)
      .catch((e: unknown) => {
        if (!valid()) return;
        if (
          e instanceof ApiError &&
          (e.status === 401 ||
            ["AUTH_EXPIRED", "RESOURCE_UNAVAILABLE"].includes(e.code))
        ) {
          this.stopStream();
          this.cache = {};
          this.close();
          this.error = errorMessage(e);
          return;
        }
        fallback();
      });
  }
  private fail(e: unknown, version: number, id: string) {
    if (this.disposed || version !== this.generation || id !== this.documentId)
      return;
    this.error = errorMessage(e, "暂时无法读取译文");
    this.needsSettings =
      e instanceof ApiError &&
      ["LLM_NOT_CONFIGURED", "LLM_PROVIDER_NOT_FOUND"].includes(e.code);
    if (
      e instanceof ApiError &&
      ["PDF_VERSION_CONFLICT", "DOCUMENT_NOT_FOUND"].includes(e.code)
    ) {
      this.cache = {};
      this.pages = {};
      this.close();
    }
  }
  private schedule(version: number, id: string, key: string, jobId: string) {
    this.stopPolling();
    if (typeof document !== "undefined" && document.hidden) return;
    this.streamStatus = "polling";
    this.timer = setTimeout(
      () => void this.poll(version, id, key, jobId),
      this.delay,
    );
    this.delay = Math.min(2000, this.delay * 1.5);
  }
  private async poll(version: number, id: string, key: string, jobId: string) {
    if (version !== this.generation || this.disposed) return;
    const epoch = this.documentEpoch,
      revision = Object.values(this.pages)[0]?.fileRevision;
    try {
      const job = await api.getTranslationJob(id, jobId);
      if (job.id !== jobId) return;
      const previous = this.cache[key];
      this.accept(
        {
          cacheHit: false,
          requestUsage: null,
          translation: job.translation ?? previous?.translation ?? null,
          job,
        },
        version,
        id,
        key,
        revision,
        epoch,
      );
    } catch (e) {
      this.fail(e, version, id);
      if (
        version === this.generation &&
        id === this.documentId &&
        !this.disposed &&
        !(e instanceof ApiError && [401, 403, 404, 409].includes(e.status))
      )
        this.schedule(version, id, key, jobId);
    }
  }
  visibility() {
    this.stopPolling();
    this.stopIndexPolling();
    if (!document.hidden) {
      this.fallbackJobId = null;
      this.indexFailures.clear();
      for (const pageIndex of this.watchedPages) void this.loadPage(pageIndex);
    }
    if (!document.hidden && this.target && active(this.result?.job ?? null))
      void this.poll(
        this.generation,
        this.documentId,
        this.target.key,
        this.result!.job!.id,
      );
  }
  async retry() {
    const target = this.target;
    if (!target || this.busy) return;
    const job = this.result?.job;
    if (!job) {
      await this.open(target);
      return;
    }
    if (active(job)) {
      this.error = "";
      await this.poll(this.generation, this.documentId, target.key, job.id);
      return;
    }
    await this.mutate(() =>
      api.retryTranslation(
        this.documentId,
        job.id,
        (this.keys[`retry:${job.id}`] ??= crypto.randomUUID()),
        job.state === "unknown",
      ),
    );
  }
  async regenerate() {
    const translation = this.result?.translation;
    if (!translation || this.busy) return;
    await this.mutate(() =>
      api.regenerateTranslation(
        this.documentId,
        translation.id,
        (this.keys[`regenerate:${translation.id}`] ??= crypto.randomUUID()),
      ),
    );
  }
  private async mutate(send: () => Promise<PdfTranslationResponse>) {
    const target = this.target;
    if (!target) return;
    const version = this.generation,
      id = this.documentId,
      epoch = this.documentEpoch,
      revision = Object.values(this.pages)[0]?.fileRevision;
    this.busy = true;
    this.menu = false;
    this.error = "";
    try {
      this.accept(await send(), version, id, target.key, revision, epoch);
    } catch (e) {
      this.fail(e, version, id);
    } finally {
      if (version === this.generation) this.busy = false;
    }
  }
}
