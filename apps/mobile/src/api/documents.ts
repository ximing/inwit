import type {
  AcceptProposedResult,
  CreateChatInput,
  CreateDocumentInput,
  CreateSelectionCardsInput,
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
import { request } from './client';

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

export function getDocument(id: string): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/api/documents/${id}`);
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
