import type {
  ConversationDetail,
  ConversationList,
  RetryConversationInput,
  SendConversationInput,
} from '@inwit/dto';
import { request } from './client';

export function listConversations(limit = 30): Promise<ConversationList> {
  return request<ConversationList>(`/api/conversations?limit=${String(limit)}`);
}

export function createConversation(input: SendConversationInput): Promise<ConversationDetail> {
  return request<ConversationDetail>('/api/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/conversations/${id}`);
}

export function deleteConversation(id: string): Promise<void> {
  return request<void>(`/api/conversations/${id}`, { method: 'DELETE' });
}

export function sendConversationMessage(
  id: string,
  input: SendConversationInput,
): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/conversations/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function retryConversationMessage(
  id: string,
  messageId: string,
  input: RetryConversationInput,
): Promise<ConversationDetail> {
  return request<ConversationDetail>(`/api/conversations/${id}/messages/${messageId}/retry`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
