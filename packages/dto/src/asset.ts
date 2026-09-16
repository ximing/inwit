import { z } from 'zod';
import { MULTIPART_PART_SIZE } from './document.js';

export const ASSET_KINDS = ['image', 'video'] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const ASSET_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Frontend hint: files larger than this should prefer multipart. Not enforced. */
export const ASSET_MULTIPART_THRESHOLD_BYTES = 20 * 1024 * 1024;
export const ASSET_RESOLVE_MAX_SRCS = 50;
export const ASSET_MULTIPART_PART_SIZE = MULTIPART_PART_SIZE;

export const ASSET_IMAGE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export const ASSET_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export const assetUploadInputSchema = z.object({
  kind: assetKindSchema,
  contentType: z.string().min(1).max(127),
  sizeBytes: z.number().int().positive(),
});
export type AssetUploadInput = z.infer<typeof assetUploadInputSchema>;

export const assetUploadResponseSchema = z.object({
  uploadUrl: z.string().url(),
  key: z.string().min(1).max(500),
  /** `asset:<key>` — insert into markdown / node attrs. */
  assetSrc: z.string().min(1).max(520),
});
export type AssetUploadResponse = z.infer<typeof assetUploadResponseSchema>;

export const assetResolveInputSchema = z.object({
  srcs: z.array(z.string()).max(ASSET_RESOLVE_MAX_SRCS),
});
export type AssetResolveInput = z.infer<typeof assetResolveInputSchema>;

export const assetResolveResponseSchema = z.object({
  urls: z.record(z.string()),
});
export type AssetResolveResponse = z.infer<typeof assetResolveResponseSchema>;

export const assetMultipartInitInputSchema = assetUploadInputSchema;
export type AssetMultipartInitInput = AssetUploadInput;

export const assetMultipartInitResponseSchema = z.object({
  uploadId: z.string().min(1),
  key: z.string().min(1).max(500),
  assetSrc: z.string().min(1).max(520),
  partSize: z.number().int().positive(),
});
export type AssetMultipartInitResponse = z.infer<typeof assetMultipartInitResponseSchema>;

export const assetMultipartSignInputSchema = z.object({
  uploadId: z.string().min(1),
  key: z.string().min(1).max(500),
  partNumbers: z.array(z.number().int().positive().max(10_000)).min(1).max(1000),
});
export type AssetMultipartSignInput = z.infer<typeof assetMultipartSignInputSchema>;

export const assetMultipartPartUrlSchema = z.object({
  partNumber: z.number().int().positive(),
  uploadUrl: z.string().url(),
});
export type AssetMultipartPartUrl = z.infer<typeof assetMultipartPartUrlSchema>;

export const assetMultipartSignResponseSchema = z.object({
  parts: z.array(assetMultipartPartUrlSchema),
});
export type AssetMultipartSignResponse = z.infer<typeof assetMultipartSignResponseSchema>;

export const assetMultipartCompletePartSchema = z.object({
  partNumber: z.number().int().positive().max(10_000),
  etag: z.string().min(1).max(200),
});
export type AssetMultipartCompletePart = z.infer<typeof assetMultipartCompletePartSchema>;

export const assetMultipartCompleteInputSchema = z.object({
  uploadId: z.string().min(1),
  key: z.string().min(1).max(500),
  parts: z.array(assetMultipartCompletePartSchema).min(1).max(10_000),
});
export type AssetMultipartCompleteInput = z.infer<typeof assetMultipartCompleteInputSchema>;

export const assetMultipartCompleteResponseSchema = z.object({
  key: z.string().min(1).max(500),
  assetSrc: z.string().min(1).max(520),
});
export type AssetMultipartCompleteResponse = z.infer<typeof assetMultipartCompleteResponseSchema>;
