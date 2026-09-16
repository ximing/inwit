import {
  ASSET_MULTIPART_PART_SIZE,
  type AssetMultipartCompleteInput,
  type AssetMultipartCompleteResponse,
  type AssetMultipartInitInput,
  type AssetMultipartInitResponse,
  type AssetMultipartSignInput,
  type AssetMultipartSignResponse,
  type AssetResolveResponse,
  type AssetUploadInput,
  type AssetUploadResponse,
} from '@inwit/dto';
import { AppError } from '../errors.js';
import {
  completeMultipartUpload,
  createMultipartUpload,
  isStorageConfigured,
  presignGet,
  presignPut,
  presignUploadPart,
} from '../storage/client.js';
import { logger } from '../utils/logger.js';
import {
  assetKeyFor,
  assetSrcFromKey,
  assertOwnedAssetKey,
  classifyResolveSrcs,
  validateAssetCompleteParts,
  validateAssetPartNumbers,
  validateAssetUpload,
} from './asset-logic.js';

const MULTIPART_PART_URL_TTL_SEC = 15 * 60;

function requireStorage(): void {
  if (!isStorageConfigured()) throw AppError.of(503, 'STORAGE_NOT_CONFIGURED');
}

export async function requestAssetUpload(
  userId: string,
  input: AssetUploadInput,
): Promise<AssetUploadResponse> {
  requireStorage();
  const { mime, ext } = validateAssetUpload(input.kind, input.contentType, input.sizeBytes);
  const key = assetKeyFor(userId, ext);
  const uploadUrl = await presignPut(key, mime);
  return { uploadUrl, key, assetSrc: assetSrcFromKey(key) };
}

export async function resolveAssetUrls(
  userId: string,
  srcs: readonly string[],
): Promise<AssetResolveResponse> {
  const classified = classifyResolveSrcs(userId, srcs);
  const urls: Record<string, string> = {};
  const pending: Array<{ src: string; key: string }> = [];
  const seen = new Set<string>();
  for (const item of classified) {
    if (seen.has(item.src)) continue;
    seen.add(item.src);
    if (item.type === 'http') {
      urls[item.src] = item.src;
      continue;
    }
    pending.push({ src: item.src, key: item.key });
  }
  if (pending.length > 0) requireStorage();
  await Promise.all(
    pending.map(async ({ src, key }) => {
      urls[src] = await presignGet(key);
    }),
  );
  return { urls };
}

export async function initAssetMultipart(
  userId: string,
  input: AssetMultipartInitInput,
): Promise<AssetMultipartInitResponse> {
  requireStorage();
  const { mime, ext } = validateAssetUpload(input.kind, input.contentType, input.sizeBytes);
  const key = assetKeyFor(userId, ext);
  const uploadId = await createMultipartUpload(key, mime);
  return {
    uploadId,
    key,
    assetSrc: assetSrcFromKey(key),
    partSize: ASSET_MULTIPART_PART_SIZE,
  };
}

export async function signAssetMultipartParts(
  userId: string,
  input: AssetMultipartSignInput,
): Promise<AssetMultipartSignResponse> {
  requireStorage();
  assertOwnedAssetKey(userId, input.key);
  const partNumbers = validateAssetPartNumbers(input.partNumbers);
  const parts = await Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      uploadUrl: await presignUploadPart(
        input.key,
        input.uploadId,
        partNumber,
        MULTIPART_PART_URL_TTL_SEC,
      ),
    })),
  );
  return { parts };
}

export async function completeAssetMultipart(
  userId: string,
  input: AssetMultipartCompleteInput,
): Promise<AssetMultipartCompleteResponse> {
  requireStorage();
  assertOwnedAssetKey(userId, input.key);
  const parts = validateAssetCompleteParts(input.parts);
  try {
    await completeMultipartUpload(input.key, input.uploadId, parts);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn('asset.complete_multipart_failed', {
      key: input.key,
      error: err instanceof Error ? err.message : String(err),
    });
    throw AppError.of(400, 'VALIDATION_ERROR');
  }
  return { key: input.key, assetSrc: assetSrcFromKey(input.key) };
}
