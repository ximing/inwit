import type {
  PdfSegmentsPage,
  PdfTranslation,
  PdfTranslationJob,
  PdfTranslationResponse,
  SelectionTranslationRequest,
  TranslationRequest,
  TranslationSettings,
  TranslationUsage,
  UpdateTranslationSettings,
} from "@inwit/dto";
import { ApiError, clearAuth, request } from "./client.js";
import { browserFetch, browserUrl } from "./transport.js";
const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: "POST", body: JSON.stringify(body) });
export const getTranslationSettings = () =>
  request<TranslationSettings>("/api/settings/translation");
export const saveTranslationSettings = (body: UpdateTranslationSettings) =>
  request<TranslationSettings>("/api/settings/translation", {
    method: "PUT",
    body: JSON.stringify(body),
  });
export const deleteTranslationSettings = () =>
  request<void>("/api/settings/translation", { method: "DELETE" });
export const testTranslationSettings = () =>
  post<{ ok: boolean; errorCode: string | null; usage: TranslationUsage }>(
    "/api/settings/translation/test",
    {},
  );
export const getPdfSegments = (id: string, pageIndex: number) =>
  request<PdfSegmentsPage>(
    `/api/documents/${id}/pdf-segments?pageIndex=${pageIndex}`,
  );
export const getTranslations = (
  id: string,
  fileRevision: string,
  segmentIds: string[],
) =>
  request<Record<string, PdfTranslationResponse>>(
    `/api/documents/${id}/translations?fileRevision=${encodeURIComponent(fileRevision)}&segmentIds=${encodeURIComponent(segmentIds.join(","))}`,
  );
export const createTranslation = (id: string, body: TranslationRequest) =>
  post<PdfTranslationResponse>(`/api/documents/${id}/translations`, body);
export const createSelectionTranslation = (
  id: string,
  body: SelectionTranslationRequest,
) =>
  post<PdfTranslationResponse>(
    `/api/documents/${id}/translations/selection`,
    body,
  );
export const getTranslationJob = (id: string, jobId: string) =>
  request<PdfTranslationJob>(`/api/documents/${id}/translation-jobs/${jobId}`);
export const retryTranslation = (
  id: string,
  jobId: string,
  idempotencyKey: string,
  acknowledgeUnknownCharge = false,
) =>
  post<PdfTranslationResponse>(
    `/api/documents/${id}/translation-jobs/${jobId}/retry`,
    {
      idempotencyKey,
      acknowledgeUnknownCharge,
    },
  );
export const regenerateTranslation = (
  id: string,
  translationId: string,
  idempotencyKey: string,
) =>
  post<PdfTranslationResponse>(
    `/api/documents/${id}/translations/${translationId}/regenerate`,
    {
      idempotencyKey,
    },
  );

/** Read-only stream. A disconnected subscription never creates or retries a job. */
export async function streamTranslationJob(
  id: string,
  jobId: string,
  signal: AbortSignal,
  onSnapshot: (job: PdfTranslationJob) => void,
): Promise<void> {
  const response = await browserFetch(
    browserUrl(`/api/documents/${id}/translation-jobs/${jobId}/stream`),
    { signal, headers: { Accept: "text/event-stream" } },
  );
  if (!response.ok) {
    if (response.status === 401) clearAuth();
    throw new ApiError(
      response.status,
      "TRANSLATION_STREAM_UNAVAILABLE",
      "实时连接暂不可用",
    );
  }
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  )
    throw new Error("Translation stream unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let event = "";
  let data: string[] = [];
  const line = (value: string) => {
    if (!value) {
      if (data.length) {
        const parsed: unknown = JSON.parse(data.join("\n"));
        if (event === "error") {
          const code = (parsed as { code?: string }).code;
          if (code === "AUTH_EXPIRED") clearAuth();
          throw new ApiError(
            code === "AUTH_EXPIRED" ? 401 : 404,
            code ?? "RESOURCE_UNAVAILABLE",
            "实时订阅已结束",
          );
        }
        if (event === "snapshot") {
          const job = parsed as PdfTranslationJob;
          if (
            job.id !== jobId ||
            ![
              "queued",
              "preparing",
              "dispatched",
              "succeeded",
              "failed",
              "unknown",
              "cancelled",
            ].includes(job.state)
          )
            throw new Error("Invalid translation snapshot");
          if (
            job.draft &&
            (!/^\d+$/.test(job.draft.seq) ||
              typeof job.draft.text !== "string" ||
              typeof job.draft.streamId !== "string")
          )
            throw new Error("Invalid translation draft");
          onSnapshot(job);
        }
      }
      event = "";
      data = [];
    } else if (value.startsWith("event:")) event = value.slice(6).trim();
    else if (value.startsWith("data:"))
      data.push(value.slice(5).replace(/^ /, ""));
  };
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        line(pending.slice(0, newline).replace(/\r$/, ""));
        pending = pending.slice(newline + 1);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
