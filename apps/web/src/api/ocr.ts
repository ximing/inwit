import type { OcrConfig, OcrTestResult, UpsertOcrConfigInput } from '@inwit/dto';
import { request } from './client';

export function getOcrConfig(): Promise<OcrConfig | null> {
  return request<OcrConfig | null>('/api/ocr-config');
}

export function upsertOcrConfig(input: UpsertOcrConfigInput): Promise<OcrConfig> {
  return request<OcrConfig>('/api/ocr-config', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function testOcrConfig(): Promise<OcrTestResult> {
  return request<OcrTestResult>('/api/ocr-config/test', { method: 'POST' });
}
