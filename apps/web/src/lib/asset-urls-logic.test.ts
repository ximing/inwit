import { ASSET_RESOLVE_MAX_SRCS } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import {
  addInFlight,
  chunkSrcs,
  isAssetSrc,
  isHttpSrc,
  liveAssetUrl,
  markResolveFailure,
  mergeResolvedUrls,
  partitionInFlight,
  removeInFlight,
  srcsNeedingResolve,
  uniqueSrcs,
} from './asset-urls-logic';
import { PRESIGN_GET_TTL_MS, PRESIGN_REFRESH_MARGIN_MS } from './presign-cache-logic';

const USER = '11111111-1111-4111-8111-111111111111';
const FILE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ASSET = `asset:users/${USER}/doc-assets/${FILE}.png`;
const ASSET_B = `asset:users/${USER}/doc-assets/${FILE}.mp4`;
const HTTP = 'https://cdn.example/pic.png';
const SIGNED = 'https://s3.example/obj?X-Amz-Expires=3600';

describe('isAssetSrc / isHttpSrc', () => {
  it('accepts the asset: object-key form and http(s) URLs', () => {
    expect(isAssetSrc(ASSET)).toBe(true);
    expect(isAssetSrc(ASSET_B)).toBe(true);
    expect(isHttpSrc(HTTP)).toBe(true);
    expect(isHttpSrc('http://127.0.0.1:4569/bucket/key')).toBe(true);
  });

  it('rejects malformed asset keys, relative paths, and other schemes', () => {
    expect(isAssetSrc('asset:../secret')).toBe(false);
    expect(isAssetSrc(`asset:users/${USER}/other/${FILE}.png`)).toBe(false);
    expect(isAssetSrc(HTTP)).toBe(false);
    expect(isHttpSrc(ASSET)).toBe(false);
    expect(isHttpSrc('/relative.png')).toBe(false);
    expect(isHttpSrc('blob:https://example/1')).toBe(false);
    expect(isHttpSrc('data:image/png;base64,aa')).toBe(false);
  });
});

describe('uniqueSrcs', () => {
  it('drops empties and keeps first-seen order', () => {
    expect(uniqueSrcs(['', ASSET, HTTP, ASSET, ''])).toEqual([ASSET, HTTP]);
  });
});

describe('srcsNeedingResolve', () => {
  it('drops http(s), duplicates, empties, and malformed asset keys', () => {
    expect(srcsNeedingResolve([HTTP, ASSET, ASSET, '', 'asset:nope'], {})).toEqual([ASSET]);
  });

  it('skips a freshly cached signed url', () => {
    const now = 1_000_000;
    expect(
      srcsNeedingResolve([ASSET], { [ASSET]: { url: SIGNED, fetchedAt: now } }, now),
    ).toEqual([]);
    expect(
      srcsNeedingResolve(
        [ASSET],
        { [ASSET]: { url: SIGNED, fetchedAt: now } },
        now + PRESIGN_GET_TTL_MS - PRESIGN_REFRESH_MARGIN_MS - 1,
      ),
    ).toEqual([]);
  });

  it('re-resolves five minutes before the 1h TTL', () => {
    const fetchedAt = 1_000_000;
    expect(
      srcsNeedingResolve(
        [ASSET],
        { [ASSET]: { url: SIGNED, fetchedAt } },
        fetchedAt + PRESIGN_GET_TTL_MS - PRESIGN_REFRESH_MARGIN_MS,
      ),
    ).toEqual([ASSET]);
  });

  it('cools down failed entries for 10s then retries', () => {
    const fetchedAt = 5_000;
    const cache = { [ASSET]: { url: '', fetchedAt } };
    expect(srcsNeedingResolve([ASSET], cache, fetchedAt + 1_000)).toEqual([]);
    expect(srcsNeedingResolve([ASSET], cache, fetchedAt + 10_000)).toEqual([ASSET]);
  });
});

describe('partitionInFlight / addInFlight / removeInFlight', () => {
  it('dedupes concurrent resolve of the same src', () => {
    const needed = srcsNeedingResolve([ASSET, ASSET_B], {});
    const first = partitionInFlight(needed, new Set());
    expect(first).toEqual({ toFetch: [ASSET, ASSET_B], waiting: [] });

    const inFlight = addInFlight(new Set(), first.toFetch);
    const again = partitionInFlight(srcsNeedingResolve([ASSET, ASSET_B, ASSET], {}), inFlight);
    expect(again).toEqual({ toFetch: [], waiting: [ASSET, ASSET_B] });

    const afterA = removeInFlight(inFlight, [ASSET]);
    const leftover = partitionInFlight([ASSET, ASSET_B], afterA);
    expect(leftover).toEqual({ toFetch: [ASSET], waiting: [ASSET_B] });
  });

  it('splits a mixed batch into fetch vs wait', () => {
    expect(partitionInFlight([ASSET, ASSET_B], new Set([ASSET]))).toEqual({
      toFetch: [ASSET_B],
      waiting: [ASSET],
    });
  });
});

describe('mergeResolvedUrls / markResolveFailure', () => {
  it('writes non-empty urls and skips blanks', () => {
    const now = 10;
    const merged = mergeResolvedUrls({}, { [ASSET]: SIGNED, [ASSET_B]: '' }, now);
    expect(merged).toEqual({ [ASSET]: { url: SIGNED, fetchedAt: now } });
  });

  it('records empty-url failures for the retry cooldown', () => {
    const now = 20;
    expect(markResolveFailure({ [ASSET]: { url: SIGNED, fetchedAt: 1 } }, [ASSET, ASSET_B], now)).toEqual({
      [ASSET]: { url: '', fetchedAt: now },
      [ASSET_B]: { url: '', fetchedAt: now },
    });
  });
});

describe('liveAssetUrl', () => {
  it('returns http(s) as-is and a live cached asset url', () => {
    const now = 1_000_000;
    expect(liveAssetUrl(HTTP, {})).toBe(HTTP);
    expect(liveAssetUrl(ASSET, { [ASSET]: { url: SIGNED, fetchedAt: now } }, now)).toBe(SIGNED);
  });

  it('returns null for stale, failed, or unknown asset srcs', () => {
    const fetchedAt = 1;
    expect(liveAssetUrl(ASSET, {})).toBeNull();
    expect(
      liveAssetUrl(ASSET, { [ASSET]: { url: SIGNED, fetchedAt } }, fetchedAt + PRESIGN_GET_TTL_MS),
    ).toBeNull();
    expect(liveAssetUrl(ASSET, { [ASSET]: { url: '', fetchedAt: 5_000 } }, 5_000)).toBeNull();
    expect(liveAssetUrl('asset:nope', {})).toBeNull();
  });
});

describe('chunkSrcs', () => {
  it('splits at the resolve API cap', () => {
    const srcs = Array.from({ length: ASSET_RESOLVE_MAX_SRCS + 2 }, (_, i) => `${ASSET}-${i}`);
    const chunks = chunkSrcs(srcs);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(ASSET_RESOLVE_MAX_SRCS);
    expect(chunks[1]).toEqual(srcs.slice(ASSET_RESOLVE_MAX_SRCS));
    expect(chunkSrcs([])).toEqual([]);
  });
});
