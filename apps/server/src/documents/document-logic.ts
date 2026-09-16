/** Zero-width space used by the editor as an empty paragraph placeholder. */
const ZWSP = '\u200b';

export function isBlankDocumentContent(contentMd: string): boolean {
  return contentMd.replaceAll(ZWSP, '').trim().length === 0;
}

/**
 * First digest after a blank document gains real content.
 * Skip when cards already exist, or a digest job is already pending/running.
 */
export function shouldEnqueueDigest(
  existing: { contentMd: string },
  input: { contentMd?: string | undefined },
  cardCount: number,
  hasActiveDigestJob = false,
): boolean {
  if (input.contentMd === undefined) return false;
  if (!isBlankDocumentContent(existing.contentMd)) return false;
  if (isBlankDocumentContent(input.contentMd)) return false;
  if (cardCount > 0) return false;
  if (hasActiveDigestJob) return false;
  return true;
}
