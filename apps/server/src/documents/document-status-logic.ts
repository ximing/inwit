import { documentIdFromJobPayload, type JobPayload, type JobType } from '@inwit/dto';

/**
 * Job types whose outcome owns the target document's pipeline status.
 * `topic` covers only fill jobs (suggest/organize payloads carry no
 * documentId and fall through to null). `selection` is excluded on purpose:
 * it derives extra cards but never drives the document's status.
 */
const PIPELINE_JOB_TYPES: ReadonlySet<JobType> = new Set(['digest', 'chat', 'extract', 'ocr', 'topic']);

/** Document whose pipeline status this job drives, or null when it owns none. */
export function pipelineDocumentId(job: { type: JobType; payload: JobPayload }): string | null {
  if (!PIPELINE_JOB_TYPES.has(job.type)) return null;
  return documentIdFromJobPayload(job.payload) ?? null;
}

export const FAIL_REASON_MAX = 2000;

export function clampFailReason(reason: string): string {
  const trimmed = reason.trim() || 'unknown error';
  return trimmed.length > FAIL_REASON_MAX ? trimmed.slice(0, FAIL_REASON_MAX) : trimmed;
}
