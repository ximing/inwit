import type { CardDetail, CardLinksResponse } from '@inwit/dto';
import { request } from './client';

export function getCard(id: string): Promise<CardDetail> {
  return request<CardDetail>(`/api/cards/${id}`);
}

export function getCardLinks(id: string): Promise<CardLinksResponse> {
  return request<CardLinksResponse>(`/api/cards/${id}/links`);
}

export function deleteCardLink(id: string): Promise<void> {
  return request<void>(`/api/card-links/${id}`, { method: 'DELETE' });
}
