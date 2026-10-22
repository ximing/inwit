import type {
  ArchiveListQuery,
  ArchivedDocumentsResponse,
  CreateChatInput,
  CreateDocumentInput,
  CreateSelectionCardsInput,
  AcceptProposedResult,
  Document,
  DocumentDetail,
  DocumentFileResponse,
  DocumentListItem,
  ExcerptUploadInput,
  ExcerptUploadResponse,
  ImportAbortInput,
  ImportCompleteInput,
  ImportInitInput,
  ImportInitResponse,
  ImportPartsInput,
  ImportPartsResponse,
  Job,
  Paginated,
  ScreenshotInitInput,
  ScreenshotInitResponse,
  UpdateDocumentInput,
} from '@inwit/dto';
import { ApiError, request, requestConditional } from './client';

export function listDocuments(query: {
  topicId?: string;
  status?: Document['status'];
  limit?: number;
  offset?: number;
}): Promise<Paginated<DocumentListItem>> {
  const params = new URLSearchParams();
  if (query.topicId) params.set('topicId', query.topicId);
  if (query.status) params.set('status', query.status);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.offset !== undefined) params.set('offset', String(query.offset));
  const qs = params.toString();
  return request<Paginated<DocumentListItem>>(`/api/documents${qs ? `?${qs}` : ''}`);
}

export function createDocument(input: CreateDocumentInput): Promise<Document> {
  return request<Document>('/api/documents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function initImport(input: ImportInitInput): Promise<ImportInitResponse> {
  return request<ImportInitResponse>('/api/documents/import/init', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function presignImportParts(
  documentId: string,
  input: ImportPartsInput,
): Promise<ImportPartsResponse> {
  return request<ImportPartsResponse>(`/api/documents/import/${documentId}/parts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function completeImport(documentId: string, input: ImportCompleteInput): Promise<Document> {
  return request<Document>(`/api/documents/import/${documentId}/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function abortImport(documentId: string, input: ImportAbortInput): Promise<void> {
  return request<void>(`/api/documents/import/${documentId}/abort`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function initScreenshot(input: ScreenshotInitInput): Promise<ScreenshotInitResponse> {
  return request<ScreenshotInitResponse>('/api/documents/screenshot/init', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function completeScreenshot(documentId: string): Promise<Document> {
  return request<Document>(`/api/documents/screenshot/${documentId}/complete`, {
    method: 'POST',
  });
}

export function retryDocument(documentId: string): Promise<Job> {
  return request<Job>(`/api/documents/${documentId}/retry`, { method: 'POST' });
}

export function createChat(input: CreateChatInput): Promise<Document> {
  return request<Document>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

type CachedDetail = { etag: string; body: DocumentDetail };

const detailCache = new Map<string, CachedDetail>();
const detailInflight = new Map<string, Promise<DocumentDetail>>();

/** Drop a stored validator. The next read fetches the document again. */
export function dropCachedDocument(id: string): void {
  detailCache.delete(id);
}

export function clearDocumentDetailCache(): void {
  detailCache.clear();
  detailInflight.clear();
}

async function loadDocumentDetail(id: string): Promise<DocumentDetail> {
  const cached = detailCache.get(id);
  try {
    const result = await requestConditional<DocumentDetail>(
      `/api/documents/${id}`,
      cached?.etag,
    );
    if (result.status === 304) {
      if (!cached) throw new ApiError(304, 'NOT_MODIFIED', '文档没有变化');
      return structuredClone(cached.body);
    }
    if (result.etag) detailCache.set(id, { etag: result.etag, body: structuredClone(result.body) });
    else detailCache.delete(id);
    return result.body;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) detailCache.delete(id);
    throw err;
  }
}

export function getDocument(id: string): Promise<DocumentDetail> {
  const existing = detailInflight.get(id);
  if (existing) return existing;
  const task = loadDocumentDetail(id).finally(() => {
    if (detailInflight.get(id) === task) detailInflight.delete(id);
  });
  detailInflight.set(id, task);
  return task;
}

export function acceptProposedCards(id: string): Promise<AcceptProposedResult> {
  return request<AcceptProposedResult>(`/api/documents/${id}/cards/accept-proposed`, {
    method: 'POST',
  });
}

export function enqueueSelectionCards(
  id: string,
  input: CreateSelectionCardsInput,
): Promise<Job> {
  return request<Job>(`/api/documents/${id}/selection-cards`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateDocument(id: string, input: UpdateDocumentInput): Promise<Document> {
  return request<Document>(`/api/documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function getDocumentFile(id: string): Promise<DocumentFileResponse> {
  return request<DocumentFileResponse>(`/api/documents/${id}/file`);
}

export function requestExcerptUpload(
  id: string,
  input: ExcerptUploadInput,
): Promise<ExcerptUploadResponse> {
  return request<ExcerptUploadResponse>(`/api/documents/${id}/excerpts`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** 移入回收站（30 天内可在设置页恢复）。 */
export function deleteDocument(id: string): Promise<void> {
  return request<void>(`/api/documents/${id}`, { method: 'DELETE' });
}

export function listArchivedDocuments(query: ArchiveListQuery): Promise<ArchivedDocumentsResponse> {
  return request<ArchivedDocumentsResponse>(
    `/api/documents/archived?page=${query.page}&limit=${query.limit}`,
  );
}

export function restoreDocument(id: string): Promise<Document> {
  return request<Document>(`/api/documents/${id}/restore`, { method: 'POST' });
}

export function destroyDocumentPermanently(id: string): Promise<void> {
  return request<void>(`/api/documents/${id}/permanent`, { method: 'DELETE' });
}
