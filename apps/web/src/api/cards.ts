import type {
  Card,
  CardDetail,
  CardImageResponse,
  CardLinksResponse,
  CreateCardInput,
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

export function getCardImage(id: string): Promise<CardImageResponse> {
  return request<CardImageResponse>(`/api/cards/${id}/image`);
}

export function getCardLinks(id: string): Promise<CardLinksResponse> {
  return request<CardLinksResponse>(`/api/cards/${id}/links`);
}

export function deleteCardLink(id: string): Promise<void> {
  return request<void>(`/api/card-links/${id}`, { method: 'DELETE' });
}
