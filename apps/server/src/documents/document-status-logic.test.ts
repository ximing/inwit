import { describe, expect, it } from 'vitest';
import { clampFailReason, FAIL_REASON_MAX, pipelineDocumentId } from './document-status-logic.js';

const DOC_ID = '00000000-0000-4000-8000-000000000001';

describe('pipelineDocumentId', () => {
  it('returns the documentId for pipeline job types', () => {
    for (const type of ['digest', 'chat', 'extract', 'ocr'] as const) {
      expect(pipelineDocumentId({ type, payload: { documentId: DOC_ID } })).toBe(DOC_ID);
    }
  });

  it('covers topic fill jobs but not suggest/organize', () => {
    expect(
      pipelineDocumentId({ type: 'topic', payload: { action: 'fill', documentId: DOC_ID } }),
    ).toBe(DOC_ID);
    expect(pipelineDocumentId({ type: 'topic', payload: { action: 'organize', topicId: 't' } })).toBeNull();
    expect(pipelineDocumentId({ type: 'topic', payload: { action: 'suggest' } })).toBeNull();
  });

  it('accepts historical captureId payloads', () => {
    expect(pipelineDocumentId({ type: 'digest', payload: { captureId: DOC_ID } })).toBe(DOC_ID);
  });

  it('returns null for jobs that do not own a document status', () => {
    expect(pipelineDocumentId({ type: 'selection', payload: { documentId: DOC_ID } })).toBeNull();
    expect(pipelineDocumentId({ type: 'evolve', payload: { cardId: 'c' } })).toBeNull();
    expect(pipelineDocumentId({ type: 'weekly_report', payload: {} })).toBeNull();
  });

  it('returns null when the payload carries no documentId', () => {
    expect(pipelineDocumentId({ type: 'digest', payload: {} })).toBeNull();
  });
});

describe('clampFailReason', () => {
  it('trims whitespace', () => {
    expect(clampFailReason('  boom  ')).toBe('boom');
  });

  it('falls back for empty input', () => {
    expect(clampFailReason('   ')).toBe('unknown error');
  });

  it('caps overlong reasons', () => {
    const long = 'x'.repeat(FAIL_REASON_MAX + 50);
    expect(clampFailReason(long)).toHaveLength(FAIL_REASON_MAX);
  });
});
