import {
  ANNOTATION_RESURFACE_AGE_DAYS,
  ANNOTATION_RESURFACE_KEY_PREFIX,
  ANNOTATION_RESURFACE_MAX_ITEMS,
  annotationResurfaceContentSchema,
  type AnnotationResurfaceContent,
} from '@inwit/dto';

export const RESURFACE_AGE_MS = ANNOTATION_RESURFACE_AGE_DAYS * 24 * 60 * 60 * 1000;

const RESURFACE_KEY_RE = /^annotation_resurface_(\d{4}-\d{2}-\d{2})$/;

export function resurfaceKeyForDate(date: string): string {
  return `${ANNOTATION_RESURFACE_KEY_PREFIX}${date}`;
}

/** Normalize a raw route param into a resurface memory key; null when malformed. */
export function normalizeResurfaceKey(raw: string): string | null {
  const trimmed = raw.trim();
  const match = RESURFACE_KEY_RE.exec(trimmed);
  if (match) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return resurfaceKeyForDate(trimmed);
  return null;
}

export function parseResurfaceContent(value: unknown): AnnotationResurfaceContent | null {
  const parsed = annotationResurfaceContentSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export interface ResurfaceCandidate {
  id: string;
  documentId: string;
  quote: string;
  note: string;
  imageKey: string | null;
  anchorBlockIndex: number | null;
  createdAt: Date;
}

export interface CandidateCardHint {
  documentId: string | null;
  imageKey: string | null;
  anchorBlockIndex: number | null;
  anchorText: string | null;
}

/**
 * Pre-T25 conversions left no `convertedCardId` trace. An annotation counts as
 * already converted when a card on the same document shares its excerpt image,
 * or its block index and quote verbatim.
 */
export function isConvertedLoose(candidate: ResurfaceCandidate, card: CandidateCardHint): boolean {
  if (card.documentId !== candidate.documentId) return false;
  if (candidate.imageKey && card.imageKey && card.imageKey === candidate.imageKey) return true;
  if (
    candidate.anchorBlockIndex != null &&
    card.anchorBlockIndex != null &&
    card.anchorBlockIndex === candidate.anchorBlockIndex &&
    card.anchorText != null &&
    card.anchorText === candidate.quote
  ) {
    return true;
  }
  return false;
}

/**
 * Pick the annotations worth resurfacing today: old enough, has a note, never
 * converted (tracked or loose), never suggested before. Oldest first.
 */
export function pickResurfaceAnnotations(input: {
  candidates: ResurfaceCandidate[];
  cardHints: CandidateCardHint[];
  suggestedIds: ReadonlySet<string>;
  now: Date;
  max?: number;
}): ResurfaceCandidate[] {
  const max = input.max ?? ANNOTATION_RESURFACE_MAX_ITEMS;
  const cutoff = input.now.getTime() - RESURFACE_AGE_MS;
  const picked = input.candidates
    .filter((candidate) => {
      if (candidate.note.trim() === '') return false;
      if (candidate.createdAt.getTime() > cutoff) return false;
      if (input.suggestedIds.has(candidate.id)) return false;
      return !input.cardHints.some((card) => isConvertedLoose(candidate, card));
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return picked.slice(0, max);
}

/** Terminal status once every suggested annotation has been resolved. */
export function resurfaceTerminalStatus(content: AnnotationResurfaceContent): 'accepted' | 'dismissed' {
  return (content.acceptedCardIds?.length ?? 0) > 0 ? 'accepted' : 'dismissed';
}
