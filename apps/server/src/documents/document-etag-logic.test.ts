import { describe, expect, it } from 'vitest';
import {
  documentDetailEtag,
  ifNoneMatchSatisfied,
  normalizeIfNoneMatch,
  type DocumentDetailStamp,
} from './document-etag-logic.js';

function stamp(overrides: Partial<DocumentDetailStamp> = {}): DocumentDetailStamp {
  return {
    updatedAt: '2026-10-22T01:00:00.000Z',
    status: 'pending',
    failReason: null,
    title: '长文',
    description: null,
    topicId: null,
    topicTitle: null,
    topicUpdatedAt: null,
    answer: null,
    linkHint: null,
    fileMime: null,
    fileSize: null,
    pageCount: null,
    source: 'import',
    kind: 'document',
    contentHash: 'abc',
    cardCount: '0',
    proposedCount: '0',
    cardUpdatedAt: null,
    cardHash: '',
    questionHash: '',
    reviewUpdatedAt: null,
    reviewCount: '0',
    ...overrides,
  };
}

describe('documentDetailEtag', () => {
  it('is stable for the same stamp and changes when the body revision changes', () => {
    const etag = documentDetailEtag(stamp());
    expect(etag).toMatch(/^W\/"[0-9a-f]{64}"$/);
    expect(documentDetailEtag(stamp())).toBe(etag);
    expect(documentDetailEtag(stamp({ contentHash: 'def' }))).not.toBe(etag);
    expect(documentDetailEtag(stamp({ status: 'digested' }))).not.toBe(etag);
    expect(documentDetailEtag(stamp({ cardCount: '3', cardHash: 'cards' }))).not.toBe(etag);
  });
});

describe('ifNoneMatchSatisfied', () => {
  const etag = documentDetailEtag(stamp());

  it('matches the weak tag, the bare token, and a list', () => {
    expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
    expect(ifNoneMatchSatisfied(etag, etag)).toBe(true);
    expect(ifNoneMatchSatisfied(etag.slice(2), etag)).toBe(true);
    expect(ifNoneMatchSatisfied(`"other", ${etag}`, etag)).toBe(true);
    expect(ifNoneMatchSatisfied('*', etag)).toBe(true);
    expect(ifNoneMatchSatisfied('W/"nope"', etag)).toBe(false);
  });

  it('joins repeated headers', () => {
    expect(normalizeIfNoneMatch([etag, 'W/"nope"'])).toBe(`${etag}, W/"nope"`);
    expect(ifNoneMatchSatisfied(normalizeIfNoneMatch([etag]), etag)).toBe(true);
  });
});
