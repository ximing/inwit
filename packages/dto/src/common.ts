import { z } from 'zod';

/** Empty or whitespace means the default endpoint; any other value must be a URL. */
export const optionalBaseUrlSchema = z.preprocess((value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}, z.string().url().max(512).nullable().optional());

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  });
}

export type Paginated<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};
