import { describe, expect, it } from 'vitest';
import {
  isPresignedStale,
  livePresignedUrl,
  PRESIGN_GET_TTL_MS,
  PRESIGN_REFRESH_MARGIN_MS,
  shouldRetryPresign,
} from './presign-cache-logic';

const URL = 'https://example.test/excerpt.png?X-Amz-Expires=3600';

describe('isPresignedStale', () => {
  it('treats a missing entry as stale', () => {
    expect(isPresignedStale(undefined)).toBe(true);
  });

  it('keeps a freshly signed url', () => {
    const now = 1_000_000;
    expect(isPresignedStale({ url: URL, fetchedAt: now }, now)).toBe(false);
    expect(
      isPresignedStale(
        { url: URL, fetchedAt: now },
        now + PRESIGN_GET_TTL_MS - PRESIGN_REFRESH_MARGIN_MS - 1,
      ),
    ).toBe(false);
  });

  it('refreshes five minutes before the 1h TTL', () => {
    const fetchedAt = 1_000_000;
    expect(
      isPresignedStale(
        { url: URL, fetchedAt },
        fetchedAt + PRESIGN_GET_TTL_MS - PRESIGN_REFRESH_MARGIN_MS,
      ),
    ).toBe(true);
  });
});

describe('shouldRetryPresign', () => {
  it('retries after a short cooldown so img onError cannot loop', () => {
    const fetchedAt = 5_000;
    expect(shouldRetryPresign({ url: URL, fetchedAt }, fetchedAt + 1_000)).toBe(false);
    expect(shouldRetryPresign({ url: URL, fetchedAt }, fetchedAt + 10_000)).toBe(true);
  });
});

describe('livePresignedUrl', () => {
  it('returns null when the cached url is stale', () => {
    const fetchedAt = 1;
    expect(livePresignedUrl({ url: URL, fetchedAt }, fetchedAt + PRESIGN_GET_TTL_MS)).toBeNull();
    expect(livePresignedUrl({ url: URL, fetchedAt }, fetchedAt + 1_000)).toBe(URL);
  });
});
