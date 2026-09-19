import {
  ASSET_MULTIPART_PART_SIZE,
  type AssetImportResponse,
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
import { lookup } from 'node:dns/promises';
import { AppError } from '../errors.js';
import {
  completeMultipartUpload,
  createMultipartUpload,
  isStorageConfigured,
  presignGet,
  presignPut,
  presignUploadPart,
  putObject,
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
import {
  ASSET_IMPORT_MAX_REDIRECTS,
  ASSET_IMPORT_TIMEOUT_MS,
  classifyImportedBytes,
  importDownloadCap,
  isBlockedIp,
  parseImportUrl,
  readResponseBytes,
} from './import-logic.js';

const MULTIPART_PART_URL_TTL_SEC = 15 * 60;

function requireStorage(): void {
  if (!isStorageConfigured()) throw AppError.of(503, 'STORAGE_NOT_CONFIGURED');
}

export async function importAssetFromUrl(
  userId: string,
  url: string,
): Promise<AssetImportResponse> {
  requireStorage();
  const { bytes, contentType } = await downloadPublicMedia(url);
  const classified = classifyImportedBytes(contentType, bytes);
  const key = assetKeyFor(userId, classified.ext);
  await putObject(key, bytes, classified.mime);
  return { key, assetSrc: assetSrcFromKey(key) };
}

async function downloadPublicMedia(raw: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  let current = parseImportUrl(raw);
  await assertPublicHost(current.hostname);
  const signal = AbortSignal.timeout(ASSET_IMPORT_TIMEOUT_MS);
  for (let hop = 0; hop <= ASSET_IMPORT_MAX_REDIRECTS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { Accept: 'image/*,video/*,*/*;q=0.1' },
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw AppError.of(400, 'ASSET_IMPORT_FAILED');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location || hop === ASSET_IMPORT_MAX_REDIRECTS) {
        throw AppError.of(400, 'ASSET_IMPORT_FAILED');
      }
      try {
        current = parseImportUrl(new URL(location, current).href);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw AppError.of(400, 'ASSET_IMPORT_FAILED');
      }
      await assertPublicHost(current.hostname);
      continue;
    }
    if (!res.ok) throw AppError.of(400, 'ASSET_IMPORT_FAILED');
    const contentType = res.headers.get('content-type') ?? '';
    const bytes = await readResponseBytes(res, importDownloadCap(contentType));
    return { bytes, contentType };
  }
  throw AppError.of(400, 'ASSET_IMPORT_FAILED');
}

async function assertPublicHost(hostname: string): Promise<void> {
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw AppError.of(400, 'ASSET_IMPORT_FAILED');
  }
  if (records.length === 0 || records.some((record) => isBlockedIp(record.address))) {
    throw AppError.of(400, 'ASSET_IMPORT_BLOCKED');
  }
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
