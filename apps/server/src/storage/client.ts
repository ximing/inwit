import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { AppError } from '../errors.js';

const PUT_TTL_SEC = 15 * 60;
const GET_TTL_SEC = 3600;
const DELETE_BATCH = 1000;

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;
};

let cached: { cfg: StorageConfig; client: S3Client } | null = null;

function readStorageConfig(): StorageConfig | null {
  const endpoint = config.S3_ENDPOINT;
  const region = config.S3_REGION;
  const bucket = config.S3_BUCKET;
  const accessKey = config.S3_ACCESS_KEY;
  const secretKey = config.S3_SECRET_KEY;
  if (!endpoint || !region || !bucket || !accessKey || !secretKey) return null;
  return {
    endpoint,
    region,
    bucket,
    accessKey,
    secretKey,
    forcePathStyle: config.S3_FORCE_PATH_STYLE ?? false,
  };
}

export function isStorageConfigured(): boolean {
  return readStorageConfig() !== null;
}

function requireStorageConfig(): StorageConfig {
  const cfg = readStorageConfig();
  if (!cfg) throw AppError.of(503, 'STORAGE_NOT_CONFIGURED');
  return cfg;
}

function getClient(): { cfg: StorageConfig; client: S3Client } {
  const cfg = requireStorageConfig();
  if (
    cached &&
    cached.cfg.endpoint === cfg.endpoint &&
    cached.cfg.region === cfg.region &&
    cached.cfg.bucket === cfg.bucket &&
    cached.cfg.accessKey === cfg.accessKey &&
    cached.cfg.secretKey === cfg.secretKey &&
    cached.cfg.forcePathStyle === cfg.forcePathStyle
  ) {
    return cached;
  }
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: {
      accessKeyId: cfg.accessKey,
      secretAccessKey: cfg.secretKey,
    },
    // s3rver / MinIO reject the SDK's default CRC32 checksum headers.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  cached = { cfg, client };
  return cached;
}

export async function presignPut(
  key: string,
  contentType: string,
  ttlSec = PUT_TTL_SEC,
): Promise<string> {
  const { cfg, client } = getClient();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: ttlSec },
  );
}

export async function presignGet(key: string, ttlSec = GET_TTL_SEC): Promise<string> {
  const { cfg, client } = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }),
    { expiresIn: ttlSec },
  );
}

export async function createMultipartUpload(key: string, contentType: string): Promise<string> {
  const { cfg, client } = getClient();
  const res = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      ContentType: contentType,
    }),
  );
  if (!res.UploadId) throw AppError.of(500, 'INTERNAL_ERROR');
  return res.UploadId;
}

export async function presignUploadPart(
  key: string,
  uploadId: string,
  partNumber: number,
  ttlSec = PUT_TTL_SEC,
): Promise<string> {
  const { cfg, client } = getClient();
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn: ttlSec },
  );
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<void> {
  const { cfg, client } = getClient();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((part) => ({
          PartNumber: part.partNumber,
          ETag: part.etag,
        })),
      },
    }),
  );
}

export async function abortMultipartUpload(key: string, uploadId: string): Promise<void> {
  const { cfg, client } = getClient();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: cfg.bucket,
      Key: key,
      UploadId: uploadId,
    }),
  );
}

export async function getObjectToFile(key: string, destPath: string): Promise<void> {
  const { cfg, client } = getClient();
  const res = await client.send(
    new GetObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }),
  );
  if (!res.Body) throw AppError.of(500, 'INTERNAL_ERROR');
  const body = res.Body;
  const stream =
    body instanceof Readable
      ? body
      : Readable.fromWeb(body.transformToWebStream() as import('node:stream/web').ReadableStream);
  await pipeline(stream, createWriteStream(destPath));
}

export async function deleteObject(key: string): Promise<void> {
  const { cfg, client } = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
    }),
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const { cfg, client } = getClient();
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const chunk = keys.slice(i, i + DELETE_BATCH);
    await client.send(
      new DeleteObjectsCommand({
        Bucket: cfg.bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }
}

export async function deletePrefix(prefix: string): Promise<void> {
  const { cfg, client } = getClient();
  let token: string | undefined;
  do {
    const listed = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    const keys = (listed.Contents ?? [])
      .map((obj) => obj.Key)
      .filter((key): key is string => typeof key === 'string' && key.length > 0);
    await deleteObjects(keys);
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
}
