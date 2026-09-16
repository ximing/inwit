import {
  documentIdFromJobPayload,
  ocrJobPayloadFrom,
  type DocumentSource,
  type DocumentStatus,
  type Job,
} from '@inwit/dto';

const PIPELINE_JOB_RANK: Record<string, number> = {
  ocr: 0,
  extract: 1,
  digest: 2,
  chat: 3,
};

export type DocPipelineKind =
  | 'upload'
  | 'extract'
  | 'ocr'
  | 'digest'
  | 'failed'
  | 'interrupted'
  | 'idle';

export type DocPipelineStage = {
  kind: DocPipelineKind;
  label: string;
  pulse: boolean;
  percent: number | null;
  canCancel: boolean;
  canRetry: boolean;
};

export function pickDocumentJob(jobs: readonly Job[], documentId: string): Job | null {
  const matched = jobs.filter((job) => {
    if (job.status !== 'pending' && job.status !== 'running') return false;
    if (!(job.type in PIPELINE_JOB_RANK)) return false;
    return documentIdFromJobPayload(job.payload) === documentId;
  });
  if (matched.length === 0) return null;
  const running = matched.filter((job) => job.status === 'running');
  const pool = running.length > 0 ? running : matched;
  let best = pool[0] ?? null;
  let bestRank = best ? (PIPELINE_JOB_RANK[best.type] ?? 99) : 99;
  for (const job of pool) {
    const rank = PIPELINE_JOB_RANK[job.type] ?? 99;
    if (rank < bestRank) {
      best = job;
      bestRank = rank;
    }
  }
  return best;
}

export function ocrProgressLabel(job: Job): string {
  const parsed = ocrJobPayloadFrom(job.payload);
  const total = parsed?.totalPages ?? 0;
  const done = parsed?.donePages?.length ?? 0;
  if (total > 0) return `识别中 ${done}/${total} 页`;
  return '识别中…';
}

export function describeDocumentStage(input: {
  status: DocumentStatus;
  source: DocumentSource;
  /** Local upload percent 0–100; null when not in an upload session. */
  uploadPercent: number | null;
  hasCheckpoint: boolean;
  /** Caller-supplied: document has extractable/digestable text. */
  hasContent: boolean;
  job: Job | null;
}): DocPipelineStage {
  const { status, source, uploadPercent, hasCheckpoint, hasContent, job } = input;

  if (status === 'failed') {
    return {
      kind: 'failed',
      label: '失败',
      pulse: false,
      percent: null,
      canCancel: false,
      canRetry: true,
    };
  }

  if (uploadPercent !== null) {
    return {
      kind: 'upload',
      label: `上传中 ${uploadPercent}%`,
      pulse: true,
      percent: uploadPercent,
      canCancel: true,
      canRetry: false,
    };
  }

  if (status !== 'pending') {
    return {
      kind: 'idle',
      label: '',
      pulse: false,
      percent: null,
      canCancel: false,
      canRetry: false,
    };
  }

  if (job?.type === 'ocr') {
    return {
      kind: 'ocr',
      label: ocrProgressLabel(job),
      pulse: true,
      percent: null,
      canCancel: false,
      canRetry: false,
    };
  }
  if (job?.type === 'extract') {
    return {
      kind: 'extract',
      label: '提取中…',
      pulse: true,
      percent: null,
      canCancel: false,
      canRetry: false,
    };
  }
  if (job?.type === 'digest' || job?.type === 'chat') {
    return {
      kind: 'digest',
      label: '消化中…',
      pulse: true,
      percent: null,
      canCancel: false,
      canRetry: false,
    };
  }

  // Init finished locally but CompleteMultipart has not run — resume/cancel still possible.
  if (hasCheckpoint) {
    return {
      kind: 'upload',
      label: '上传中',
      pulse: true,
      percent: null,
      canCancel: true,
      canRetry: false,
    };
  }

  // pending + no active job + no checkpoint: pipeline stalled (e.g. digest exhausted retries).
  return {
    kind: 'interrupted',
    label: '中断',
    pulse: false,
    percent: null,
    canCancel: false,
    canRetry: hasContent || source === 'import',
  };
}
