import { z } from 'zod';
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
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Card hit with a display-ready parent document title (null if unattached). */
export const searchCardSchema = cardSchema.extend({
  documentTitle: z.string().nullable(),
});
export type SearchCard = z.infer<typeof searchCardSchema>;

export const searchResultSchema = z.object({
  documents: z.array(documentListItemSchema),
  cards: z.array(searchCardSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
