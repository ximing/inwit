import {
  ASSET_IMAGE_MAX_BYTES,
  ASSET_IMAGE_MIMES,
  ASSET_MULTIPART_THRESHOLD_BYTES,
  ASSET_VIDEO_MAX_BYTES,
  ASSET_VIDEO_MIMES,
  type AssetKind,
  type AssetMultipartCompleteInput,
  type AssetMultipartCompleteResponse,
  type AssetMultipartInitInput,
  type AssetMultipartInitResponse,
  type AssetMultipartSignInput,
  type AssetMultipartSignResponse,
  type AssetUploadInput,
  type AssetUploadResponse,
} from '@inwit/dto';
import type { PutResult } from '@/lib/presign-put';
import { sliceRanges } from '@/lib/multipart-logic';

const IMAGE_MIME_SET = new Set<string>(ASSET_IMAGE_MIMES);
const VIDEO_MIME_SET = new Set<string>(ASSET_VIDEO_MIMES);

export const UPLOAD_FAILED_MESSAGE = '上传失败，请重试';

export type UploadDocAssetApi = {
  presign: (input: AssetUploadInput) => Promise<AssetUploadResponse>;
  initMultipart: (input: AssetMultipartInitInput) => Promise<AssetMultipartInitResponse>;
  signMultipart: (input: AssetMultipartSignInput) => Promise<AssetMultipartSignResponse>;
  completeMultipart: (
    input: AssetMultipartCompleteInput,
  ) => Promise<AssetMultipartCompleteResponse>;
  put: (url: string, body: Blob, contentType: string | null) => Promise<PutResult>;
};

export type UploadDocAssetEditor = {
  insertImage: (src: string, alt: string) => void;
  insertVideo: (src: string, mime: string) => void;
  ensure: (srcs: string[]) => Promise<void>;
};

export type UploadDocAssetOptions = {
  /** Override the 20MB simple-PUT / multipart cutoff. */
  multipartThreshold?: number;
};

export type ClassifiedAsset = {
  ok: true;
  kind: AssetKind;
  mime: string;
};

export type RejectedAsset = {
  ok: false;
  message: string;
};

export class AssetUploadError extends Error {
  readonly code: 'invalid' | 'failed';

  constructor(message: string, code: 'invalid' | 'failed' = 'failed') {
    super(message);
    this.name = 'AssetUploadError';
    this.code = code;
  }
}

export function normalizeAssetContentType(contentType: string): string {
  const raw = contentType.split(';')[0] ?? contentType;
  return raw.trim().toLowerCase();
}

export function classifyAssetFile(file: { type: string; size: number }): ClassifiedAsset | RejectedAsset {
  const mime = normalizeAssetContentType(file.type);
  const size = file.size;
  if (IMAGE_MIME_SET.has(mime)) {
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, message: '不支持的文件类型' };
    }
    if (size > ASSET_IMAGE_MAX_BYTES) {
      return { ok: false, message: '图片不能超过 10MB' };
    }
    return { ok: true, kind: 'image', mime };
  }
  if (VIDEO_MIME_SET.has(mime)) {
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, message: '不支持的文件类型' };
    }
    if (size > ASSET_VIDEO_MAX_BYTES) {
      return { ok: false, message: '视频不能超过 200MB' };
    }
    return { ok: true, kind: 'video', mime };
  }
  return { ok: false, message: '不支持的文件类型' };
}

async function uploadSimple(
  file: File,
  kind: AssetKind,
  mime: string,
  api: UploadDocAssetApi,
): Promise<string> {
  const { uploadUrl, assetSrc } = await api.presign({
    kind,
    contentType: mime,
    sizeBytes: file.size,
  });
  const put = await api.put(uploadUrl, file, mime);
  if (!put.ok) throw new AssetUploadError(UPLOAD_FAILED_MESSAGE, 'failed');
  return assetSrc;
}

async function uploadMultipart(
  file: File,
  kind: AssetKind,
  mime: string,
  api: UploadDocAssetApi,
): Promise<string> {
  const init = await api.initMultipart({
    kind,
    contentType: mime,
    sizeBytes: file.size,
  });
  const ranges = sliceRanges(file.size, init.partSize);
  if (ranges.length === 0) throw new AssetUploadError(UPLOAD_FAILED_MESSAGE, 'failed');

  const parts: Array<{ partNumber: number; etag: string }> = [];
  for (const range of ranges) {
    const signed = await api.signMultipart({
      uploadId: init.uploadId,
      key: init.key,
      partNumbers: [range.partNumber],
    });
    const url = signed.parts.find((part) => part.partNumber === range.partNumber)?.uploadUrl;
    if (!url) throw new AssetUploadError(UPLOAD_FAILED_MESSAGE, 'failed');
    const blob = file.slice(range.start, range.endExclusive);
    const put = await api.put(url, blob, null);
    if (!put.ok || !put.etag) throw new AssetUploadError(UPLOAD_FAILED_MESSAGE, 'failed');
    parts.push({ partNumber: range.partNumber, etag: put.etag });
  }

  const done = await api.completeMultipart({
    uploadId: init.uploadId,
    key: init.key,
    parts,
  });
  return done.assetSrc;
}

export async function storeDocAsset(
  file: File,
  api: UploadDocAssetApi,
  options: UploadDocAssetOptions = {},
): Promise<{ assetSrc: string; kind: AssetKind; mime: string }> {
  const classified = classifyAssetFile(file);
  if (!classified.ok) throw new AssetUploadError(classified.message, 'invalid');

  const threshold = options.multipartThreshold ?? ASSET_MULTIPART_THRESHOLD_BYTES;
  const assetSrc =
    file.size > threshold
      ? await uploadMultipart(file, classified.kind, classified.mime, api)
      : await uploadSimple(file, classified.kind, classified.mime, api);
  return { assetSrc, kind: classified.kind, mime: classified.mime };
}

export async function uploadDocAsset(
  file: File,
  api: UploadDocAssetApi,
  editor: UploadDocAssetEditor,
  options: UploadDocAssetOptions = {},
): Promise<string> {
  const stored = await storeDocAsset(file, api, options);
  if (stored.kind === 'image') editor.insertImage(stored.assetSrc, file.name);
  else editor.insertVideo(stored.assetSrc, stored.mime);
  await editor.ensure([stored.assetSrc]);
  return stored.assetSrc;
}

export async function ingestAssetFiles(
  files: Iterable<File>,
  api: UploadDocAssetApi,
  editor: UploadDocAssetEditor,
  options: UploadDocAssetOptions = {},
): Promise<void> {
  for (const file of files) {
    await uploadDocAsset(file, api, editor, options);
  }
}
