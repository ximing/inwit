import type { CreateLlmConfigInput, LlmConfig, LlmTestResult } from '@inwit/dto';
import { request } from './client';

export function listLlmConfigs(): Promise<LlmConfig[]> {
  return request<LlmConfig[]>('/api/llm-configs');
}

export function createLlmConfig(input: CreateLlmConfigInput): Promise<LlmConfig> {
  return request<LlmConfig>('/api/llm-configs', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteLlmConfig(id: string): Promise<void> {
  return request<void>(`/api/llm-configs/${id}`, { method: 'DELETE' });
}

export function setDefaultLlmConfig(id: string): Promise<LlmConfig> {
  return request<LlmConfig>(`/api/llm-configs/${id}/default`, { method: 'PUT' });
}

export function testLlmConfig(id: string): Promise<LlmTestResult> {
  return request<LlmTestResult>(`/api/llm-configs/${id}/test`, { method: 'POST' });
}
