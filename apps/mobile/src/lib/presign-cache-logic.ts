/** Matches `presignGet` default TTL in apps/server/src/storage/client.ts. */
export const PRESIGN_GET_TTL_MS = 60 * 60 * 1000;
/** Refresh before the signed URL actually expires. */
export const PRESIGN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const PRESIGN_ERROR_RETRY_MS = 10_000;

export type PresignedUrlEntry = {
  url: string;
  fetchedAt: number;
};

export function isPresignedStale(
  entry: PresignedUrlEntry | undefined,
  now = Date.now(),
): boolean {
  if (!entry) return true;
  return now - entry.fetchedAt >= PRESIGN_GET_TTL_MS - PRESIGN_REFRESH_MARGIN_MS;
}

export function shouldRetryPresign(
  entry: PresignedUrlEntry | undefined,
  now = Date.now(),
): boolean {
  if (!entry) return true;
  return now - entry.fetchedAt >= PRESIGN_ERROR_RETRY_MS;
}

export function livePresignedUrl(
  entry: PresignedUrlEntry | undefined,
  now = Date.now(),
): string | null {
  if (!entry || isPresignedStale(entry, now)) return null;
  return entry.url;
}
