import type {
  CreateChatInput,
  CreateDocumentInput,
  Document,
  DocumentDetail,
  DocumentListItem,
  Paginated,
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

export function createChat(input: CreateChatInput): Promise<Document> {
  return request<Document>('/api/chat', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getDocument(id: string): Promise<DocumentDetail> {
  return request<DocumentDetail>(`/api/documents/${id}`);
}

export function updateDocument(id: string, input: UpdateDocumentInput): Promise<Document> {
  return request<Document>(`/api/documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}
