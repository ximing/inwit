import { z } from 'zod';
import { annotationKindSchema } from './annotation.js';
import { cardSchema } from './card.js';
import { documentListItemSchema } from './document.js';

const emptyToUndef = (value: unknown) => (value === '' || value === undefined ? undefined : value);

export const SEARCH_DEFAULT_LIMIT = 8;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  limit: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().min(1).max(50).default(SEARCH_DEFAULT_LIMIT),
  ),
  topicId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Card hit with a display-ready parent document title (null if unattached). */
export const searchCardSchema = cardSchema.extend({
  documentTitle: z.string().nullable(),
});
export type SearchCard = z.infer<typeof searchCardSchema>;

/** Annotation hit, display-ready: quote/note are pre-clipped server-side. */
export const searchAnnotationSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentTitle: z.string().nullable(),
  kind: annotationKindSchema,
  quote: z.string(),
  note: z.string(),
  pageIndex: z.number().int().nullable(),
  createdAt: z.string(),
});
export type SearchAnnotation = z.infer<typeof searchAnnotationSchema>;

export const searchResultSchema = z.object({
  documents: z.array(documentListItemSchema),
  cards: z.array(searchCardSchema),
  annotations: z.array(searchAnnotationSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
