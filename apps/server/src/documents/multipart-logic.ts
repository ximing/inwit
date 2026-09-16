import { AppError } from '../errors.js';

/** S3 multipart minimum part size (except the last part). */
export const MULTIPART_PART_SIZE = 5 * 1024 * 1024;
export const S3_MAX_PARTS = 10_000;
export const MULTIPART_PART_URL_TTL_SEC = 15 * 60;

export type ByteRange = {
  partNumber: number;
  start: number;
  endExclusive: number;
};

export type CompletedPart = {
  partNumber: number;
  etag: string;
};

export function partCountForSize(size: number, partSize = MULTIPART_PART_SIZE): number {
  if (!Number.isFinite(size) || size <= 0) throw AppError.of(400, 'VALIDATION_ERROR');
  if (!Number.isFinite(partSize) || partSize <= 0) throw AppError.of(400, 'VALIDATION_ERROR');
  return Math.ceil(size / partSize);
}

export function sliceRanges(size: number, partSize = MULTIPART_PART_SIZE): ByteRange[] {
  const count = partCountForSize(size, partSize);
  if (count > S3_MAX_PARTS) throw AppError.of(400, 'VALIDATION_ERROR');
  const ranges: ByteRange[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = i * partSize;
    ranges.push({
      partNumber: i + 1,
      start,
      endExclusive: Math.min(start + partSize, size),
    });
  }
  return ranges;
}

export function partNumbersForSize(size: number, partSize = MULTIPART_PART_SIZE): number[] {
  return sliceRanges(size, partSize).map((range) => range.partNumber);
}

export function validatePartNumbers(partNumbers: number[]): number[] {
  if (partNumbers.length === 0) throw AppError.of(400, 'VALIDATION_ERROR');
  const seen = new Set<number>();
  for (const n of partNumbers) {
    if (!Number.isInteger(n) || n < 1 || n > S3_MAX_PARTS) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    if (seen.has(n)) throw AppError.of(400, 'VALIDATION_ERROR');
    seen.add(n);
  }
  return [...partNumbers].sort((a, b) => a - b);
}

export function validateCompleteParts(parts: CompletedPart[]): CompletedPart[] {
  if (parts.length === 0) throw AppError.of(400, 'VALIDATION_ERROR');
  const seen = new Set<number>();
  const cleaned: CompletedPart[] = [];
  for (const part of parts) {
    if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > S3_MAX_PARTS) {
      throw AppError.of(400, 'VALIDATION_ERROR');
    }
    const etag = part.etag.trim();
    if (etag.length === 0) throw AppError.of(400, 'VALIDATION_ERROR');
    if (seen.has(part.partNumber)) throw AppError.of(400, 'VALIDATION_ERROR');
    seen.add(part.partNumber);
    cleaned.push({ partNumber: part.partNumber, etag });
  }
  cleaned.sort((a, b) => a.partNumber - b.partNumber);
  for (let i = 0; i < cleaned.length; i += 1) {
    if (cleaned[i]?.partNumber !== i + 1) throw AppError.of(400, 'VALIDATION_ERROR');
  }
  return cleaned;
}
