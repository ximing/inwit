import { describe, expect, it } from 'vitest';
import {
  STALE_MULTIPART_MAX_AGE_MS,
  isStaleMultipartUpload,
  pickStaleMultipartUploads,
} from './multipart-sweep-logic.js';

const NOW = new Date('2026-09-16T12:00:00.000Z');

describe('isStaleMultipartUpload', () => {
  it('is stale at or after the 24h cutoff', () => {
    expect(isStaleMultipartUpload(new Date(NOW.getTime() - STALE_MULTIPART_MAX_AGE_MS), NOW)).toBe(
      true,
    );
    expect(
      isStaleMultipartUpload(new Date(NOW.getTime() - STALE_MULTIPART_MAX_AGE_MS - 1), NOW),
    ).toBe(true);
    expect(
      isStaleMultipartUpload(new Date(NOW.getTime() - STALE_MULTIPART_MAX_AGE_MS + 1), NOW),
    ).toBe(false);
  });

  it('rejects missing or invalid initiated timestamps', () => {
    expect(isStaleMultipartUpload(undefined, NOW)).toBe(false);
    expect(isStaleMultipartUpload(new Date('not-a-date'), NOW)).toBe(false);
  });
});

describe('pickStaleMultipartUploads', () => {
  it('keeps only complete, old-enough uploads', () => {
    const staleInitiated = new Date(NOW.getTime() - STALE_MULTIPART_MAX_AGE_MS);
    const freshInitiated = new Date(NOW.getTime() - 60_000);
    expect(
      pickStaleMultipartUploads(
        [
          { key: 'docs/a/source.pdf', uploadId: 'old', initiated: staleInitiated },
          { key: 'docs/b/source.pdf', uploadId: 'fresh', initiated: freshInitiated },
          { key: '', uploadId: 'x', initiated: staleInitiated },
          { key: 'docs/c/source.pdf', uploadId: '', initiated: staleInitiated },
          { key: 'docs/d/source.pdf', uploadId: 'undated', initiated: undefined },
        ],
        NOW,
      ),
    ).toEqual([{ key: 'docs/a/source.pdf', uploadId: 'old' }]);
  });
});
