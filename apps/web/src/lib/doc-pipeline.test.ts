import { describe, expect, it } from 'vitest';
import type { Job, JobStatus, JobType } from '@inwit/dto';
import { describeDocumentStage, pickDocumentJob } from './doc-pipeline';

const DOC_A = '11111111-1111-4111-8111-111111111111';
const DOC_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function job(input: {
  id: string;
  type: JobType;
  status: JobStatus;
  documentId?: string;
  captureId?: string;
}): Job {
  const payload: Record<string, unknown> = {};
  if (input.documentId) payload.documentId = input.documentId;
  if (input.captureId) payload.captureId = input.captureId;
  return {
    id: input.id,
    userId: USER,
    type: input.type,
    status: input.status,
    payload,
    runAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    summary: '',
    description: '',
  };
}

describe('pickDocumentJob', () => {
  it('returns null when nothing matches the document pipeline', () => {
    expect(pickDocumentJob([], DOC_A)).toBeNull();
    expect(
      pickDocumentJob(
        [
          job({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', type: 'ocr', status: 'done', documentId: DOC_A }),
          job({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', type: 'extract', status: 'failed', documentId: DOC_A }),
          job({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', type: 'evolve', status: 'running', documentId: DOC_A }),
          job({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', type: 'ocr', status: 'running', documentId: DOC_B }),
        ],
        DOC_A,
      ),
    ).toBeNull();
  });

  it('prefers ocr over extract over digest over chat among pending jobs', () => {
    const chat = job({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'chat',
      status: 'pending',
      documentId: DOC_A,
    });
    const digest = job({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      type: 'digest',
      status: 'pending',
      documentId: DOC_A,
    });
    const extract = job({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      type: 'extract',
      status: 'pending',
      documentId: DOC_A,
    });
    const ocr = job({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      type: 'ocr',
      status: 'pending',
      documentId: DOC_A,
    });
    expect(pickDocumentJob([chat, digest, extract, ocr], DOC_A)?.type).toBe('ocr');
    expect(pickDocumentJob([chat, digest, extract], DOC_A)?.type).toBe('extract');
    expect(pickDocumentJob([chat, digest], DOC_A)?.type).toBe('digest');
    expect(pickDocumentJob([chat], DOC_A)?.type).toBe('chat');
  });

  it('prefers a running job over a higher-rank pending job', () => {
    const pendingOcr = job({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'ocr',
      status: 'pending',
      documentId: DOC_A,
    });
    const runningDigest = job({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      type: 'digest',
      status: 'running',
      documentId: DOC_A,
    });
    expect(pickDocumentJob([pendingOcr, runningDigest], DOC_A)?.id).toBe(runningDigest.id);
  });

  it('picks the highest-rank running job when several are running', () => {
    const runningDigest = job({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'digest',
      status: 'running',
      documentId: DOC_A,
    });
    const runningOcr = job({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      type: 'ocr',
      status: 'running',
      documentId: DOC_A,
    });
    expect(pickDocumentJob([runningDigest, runningOcr], DOC_A)?.type).toBe('ocr');
  });

  it('matches historical captureId payloads', () => {
    const digest = job({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: 'digest',
      status: 'pending',
      captureId: DOC_A,
    });
    expect(pickDocumentJob([digest], DOC_A)?.id).toBe(digest.id);
  });
});

describe('describeDocumentStage', () => {
  const digestJob = job({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    type: 'digest',
    status: 'running',
    documentId: DOC_A,
  });

  it('shows failed with retry regardless of jobs', () => {
    expect(
      describeDocumentStage({
        status: 'failed',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: true,
        job: digestJob,
      }),
    ).toEqual({
      kind: 'failed',
      label: '失败',
      pulse: false,
      percent: null,
      canCancel: false,
      canRetry: true,
    });
  });

  it('prefers local upload percent over a pipeline job', () => {
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: 42,
        hasCheckpoint: true,
        hasContent: false,
        job: digestJob,
      }),
    ).toMatchObject({
      kind: 'upload',
      label: '上传中 42%',
      pulse: true,
      percent: 42,
      canCancel: true,
      canRetry: false,
    });
  });

  it('treats a checkpoint with no job as an in-progress upload, not stalled', () => {
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: true,
        hasContent: false,
        job: null,
      }),
    ).toEqual({
      kind: 'upload',
      label: '上传中',
      pulse: true,
      percent: null,
      canCancel: true,
      canRetry: false,
    });
  });

  it('shows 中断 + retry when import is pending with no job and no checkpoint', () => {
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: true,
        job: null,
      }),
    ).toEqual({
      kind: 'interrupted',
      label: '中断',
      pulse: false,
      percent: null,
      canCancel: false,
      canRetry: true,
    });
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: false,
        job: null,
      }).canRetry,
    ).toBe(true);
  });

  it('shows 中断 + retry when a chat/editor digest died (has content, no job)', () => {
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'chat',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: true,
        job: null,
      }),
    ).toMatchObject({
      kind: 'interrupted',
      label: '中断',
      canRetry: true,
    });
  });

  it('does not offer retry for a blank non-import pending doc', () => {
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'editor',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: false,
        job: null,
      }),
    ).toMatchObject({
      kind: 'interrupted',
      label: '中断',
      canRetry: false,
    });
  });

  it('keeps extract/ocr/digest labels while a job is active', () => {
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: false,
        job: job({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          type: 'extract',
          status: 'running',
          documentId: DOC_A,
        }),
      }).label,
    ).toBe('提取中…');
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: false,
        job: job({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          type: 'ocr',
          status: 'running',
          documentId: DOC_A,
        }),
      }).kind,
    ).toBe('ocr');
    expect(
      describeDocumentStage({
        status: 'pending',
        source: 'import',
        uploadPercent: null,
        hasCheckpoint: false,
        hasContent: true,
        job: digestJob,
      }).label,
    ).toBe('消化中…');
  });
});
