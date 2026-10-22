import { createHash } from 'node:crypto';

/**
 * Fields that change the document detail the client renders.
 * Signed asset URLs are left out: they are regenerated on every read and must
 * not bust the validator, or a poll would never see 304.
 */
export type DocumentDetailStamp = {
  updatedAt: string;
  status: string;
  failReason: string | null;
  title: string | null;
  description: string | null;
  topicId: string | null;
  topicTitle: string | null;
  topicUpdatedAt: string | null;
  answer: string | null;
  linkHint: string | null;
  fileMime: string | null;
  fileSize: string | null;
  pageCount: string | null;
  source: string;
  kind: string;
  contentHash: string;
  cardCount: string;
  proposedCount: string;
  cardUpdatedAt: string | null;
  cardHash: string;
  questionHash: string;
  reviewUpdatedAt: string | null;
  reviewCount: string;
};

/** Weak validator. The JSON body also carries freshly signed asset URLs. */
export function documentDetailEtag(stamp: DocumentDetailStamp): string {
  const canonical = JSON.stringify([
    stamp.updatedAt,
    stamp.status,
    stamp.failReason,
    stamp.title,
    stamp.description,
    stamp.topicId,
    stamp.topicTitle,
    stamp.topicUpdatedAt,
    stamp.answer,
    stamp.linkHint,
    stamp.fileMime,
    stamp.fileSize,
    stamp.pageCount,
    stamp.source,
    stamp.kind,
    stamp.contentHash,
    stamp.cardCount,
    stamp.proposedCount,
    stamp.cardUpdatedAt,
    stamp.cardHash,
    stamp.questionHash,
    stamp.reviewUpdatedAt,
    stamp.reviewCount,
  ]);
  const hash = createHash('sha256').update(canonical).digest('hex');
  return `W/"${hash}"`;
}

export function normalizeIfNoneMatch(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value.join(', ');
  return value;
}

/**
 * Weak comparison, as If-None-Match requires.
 * `W/"abc"`, `"abc"`, and a comma-separated list all match the same token.
 */
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const want = etagToken(etag);
  if (want.length === 0) return false;
  return header.split(',').some((part) => {
    const token = part.trim();
    if (token === '*') return true;
    return etagToken(token) === want;
  });
}

function etagToken(value: string): string {
  return value.trim().replace(/^W\//i, '').replaceAll('"', '');
}
