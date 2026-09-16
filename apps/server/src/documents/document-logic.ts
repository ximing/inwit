import { documentPlainText } from './content-json.js';

/** Zero-width space used by the editor as an empty paragraph placeholder. */
const ZWSP = '\u200b';

export function isBlankDocumentContent(contentJson: unknown): boolean {
  return documentPlainText(contentJson).replaceAll(ZWSP, '').trim().length === 0;
}

/**
 * First digest after a blank document gains real content.
 * Skip when cards already exist, or a digest job is already pending/running.
 */
export function shouldEnqueueDigest(
  existing: { contentJson: unknown },
  input: { contentJson?: unknown },
  cardCount: number,
  hasActiveDigestJob = false,
): boolean {
  if (input.contentJson === undefined) return false;
  if (!isBlankDocumentContent(existing.contentJson)) return false;
  if (isBlankDocumentContent(input.contentJson)) return false;
  if (cardCount > 0) return false;
  if (hasActiveDigestJob) return false;
  return true;
}
