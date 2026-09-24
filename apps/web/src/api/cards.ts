import type {
  ArchivedCardsResponse,
  ArchiveListQuery,
  Card,
  CardDetail,
  CardImageResponse,
  CardLinksResponse,
  CreateCardInput,
  RejectCardInput,
  ReviewState,
  UpdateCardInput,
} from '@inwit/dto';
import { request } from './client';

export function createCard(input: CreateCardInput): Promise<Card> {
  return request<Card>('/api/cards', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getCard(id: string): Promise<CardDetail> {
  return request<CardDetail>(`/api/cards/${id}`);
}

export function updateCard(id: string, input: UpdateCardInput): Promise<CardDetail> {
  return request<CardDetail>(`/api/cards/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function acceptCard(id: string): Promise<CardDetail> {
  return request<CardDetail>(`/api/cards/${id}/accept`, { method: 'POST' });
}

export function rejectCard(id: string, input: RejectCardInput = {}): Promise<CardDetail> {
  return request<CardDetail>(`/api/cards/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Soft delete: the card moves to 回收站. */
export function archiveCard(id: string): Promise<void> {
  return request<void>(`/api/cards/${id}`, { method: 'DELETE' });
}

export function restoreCard(id: string): Promise<Card> {
  return request<Card>(`/api/cards/${id}/restore`, { method: 'POST' });
}

export function destroyCard(id: string): Promise<void> {
  return request<void>(`/api/cards/${id}/permanent`, { method: 'DELETE' });
}

/** 已熟悉：leave the review queue. */
export function suspendCard(id: string): Promise<ReviewState> {
  return request<ReviewState>(`/api/cards/${id}/suspend`, { method: 'POST' });
}

export function resumeCard(id: string): Promise<ReviewState> {
  return request<ReviewState>(`/api/cards/${id}/suspend`, { method: 'DELETE' });
}

export function listArchivedCards(query: ArchiveListQuery): Promise<ArchivedCardsResponse> {
  return request<ArchivedCardsResponse>(
    `/api/cards/archived?page=${query.page}&limit=${query.limit}`,
  );
}

export function getCardImage(id: string): Promise<CardImageResponse> {
  return request<CardImageResponse>(`/api/cards/${id}/image`);
}

export function getCardLinks(id: string): Promise<CardLinksResponse> {
  return request<CardLinksResponse>(`/api/cards/${id}/links`);
}

export function deleteCardLink(id: string): Promise<void> {
  return request<void>(`/api/card-links/${id}`, { method: 'DELETE' });
}
