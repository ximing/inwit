import { abortMultipartUpload, isStorageConfigured, listMultipartUploads } from './client.js';
import {
  STALE_MULTIPART_MAX_AGE_MS,
  pickStaleMultipartUploads,
} from './multipart-sweep-logic.js';
import { logger } from '../utils/logger.js';

const IMPORT_KEY_PREFIX = 'docs/';

export async function abortStaleMultipartUploads(now = new Date()): Promise<number> {
  if (!isStorageConfigured()) return 0;
  const listed = await listMultipartUploads(IMPORT_KEY_PREFIX);
  const stale = pickStaleMultipartUploads(listed, now, STALE_MULTIPART_MAX_AGE_MS);
  let aborted = 0;
  for (const item of stale) {
    try {
      await abortMultipartUpload(item.key, item.uploadId);
      aborted += 1;
    } catch (err) {
      logger.warn('storage.stale_multipart_abort_failed', {
        key: item.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return aborted;
}
