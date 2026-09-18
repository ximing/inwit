import type { DocumentSource } from '@inwit/dto';
import { documentPlainText } from './content-json.js';

/** Zero-width space used by the editor as an empty paragraph placeholder. */
const ZWSP = '\u200b';

export function isBlankDocumentContent(contentJson: unknown): boolean {
  return documentPlainText(contentJson).replaceAll(ZWSP, '').trim().length === 0;
}

export type DigestPlan =
  | { kind: 'none' }
  | { kind: 'enqueue'; delayMs: number }
  /** A pending digest already exists; push its runAt past the idle window. */
  | { kind: 'postpone'; delayMs: number };

/**
 * Decides what a content save does to the document's digest job.
 *
 * Editor-sourced documents are digested only after the user stops writing:
 * the first non-empty save enqueues a delayed digest and every further save
 * postpones it. Content arriving complete through other sources (paste,
 * open API, \u2026) is digested immediately.
 */
export function planDigestOnSave(args: {
  source: DocumentSource;
  existing: { contentJson: unknown };
  input: { contentJson?: unknown };
  contentChanged: boolean;
  cardCount: number;
  hasPendingDigest: boolean;
  hasRunningDigest: boolean;
  idleDelayMs: number;
}): DigestPlan {
  const { source, existing, input, contentChanged, cardCount, hasPendingDigest, hasRunningDigest } =
    args;
  if (input.contentJson === undefined) return { kind: 'none' };
  if (cardCount > 0) return { kind: 'none' };
  const delayMs = source === 'editor' ? args.idleDelayMs : 0;

  const becameNonEmpty =
    isBlankDocumentContent(existing.contentJson) && !isBlankDocumentContent(input.contentJson);
  if (becameNonEmpty) {
    if (hasRunningDigest) return { kind: 'none' };
    if (hasPendingDigest) return { kind: 'postpone', delayMs };
    return { kind: 'enqueue', delayMs };
  }

  // Still writing: push the pending digest past the idle window again.
  if (source === 'editor' && contentChanged && hasPendingDigest) {
    return { kind: 'postpone', delayMs };
  }
  return { kind: 'none' };
}
