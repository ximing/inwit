export const STALE_MULTIPART_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type MultipartUploadRef = {
  key: string;
  uploadId: string;
  initiated: Date | undefined;
};

export function isStaleMultipartUpload(
  initiated: Date | undefined,
  now: Date,
  maxAgeMs = STALE_MULTIPART_MAX_AGE_MS,
): boolean {
  if (!(initiated instanceof Date) || Number.isNaN(initiated.getTime())) return false;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return false;
  return now.getTime() - initiated.getTime() >= maxAgeMs;
}

export function pickStaleMultipartUploads(
  uploads: readonly MultipartUploadRef[],
  now: Date,
  maxAgeMs = STALE_MULTIPART_MAX_AGE_MS,
): Array<{ key: string; uploadId: string }> {
  const stale: Array<{ key: string; uploadId: string }> = [];
  for (const upload of uploads) {
    if (upload.key.length === 0 || upload.uploadId.length === 0) continue;
    if (!isStaleMultipartUpload(upload.initiated, now, maxAgeMs)) continue;
    stale.push({ key: upload.key, uploadId: upload.uploadId });
  }
  return stale;
}
