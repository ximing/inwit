import { z } from 'zod';

export const MEMORY_COLLECTION_STATUSES = ['active', 'retired'] as const;
export const memoryCollectionStatusSchema = z.enum(MEMORY_COLLECTION_STATUSES);
export type MemoryCollectionStatus = z.infer<typeof memoryCollectionStatusSchema>;

export const MEMORY_ENTRY_STATUSES = ['active', 'retired'] as const;
export const memoryEntryStatusSchema = z.enum(MEMORY_ENTRY_STATUSES);
export type MemoryEntryStatus = z.infer<typeof memoryEntryStatusSchema>;

export const memoryCollectionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  status: memoryCollectionStatusSchema,
  entryCount: z.number().int().nonnegative(),
  updatedAt: z.string(),
});
export type MemoryCollection = z.infer<typeof memoryCollectionSchema>;

export const memoryEntrySchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid(),
  body: z.string(),
  status: memoryEntryStatusSchema,
  updatedAt: z.string(),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;

export const memoryRevisionSchema = z.object({
  id: z.string().uuid(),
  summary: z.string(),
  diff: z.object({
    collections: z.array(
      z.object({
        op: z.enum(['create', 'update', 'retire', 'merge']),
        id: z.string().uuid(),
        title: z.string(),
        sourceIds: z.array(z.string().uuid()).optional(),
      }),
    ),
    entries: z.array(
      z.object({
        op: z.enum(['add', 'update', 'retire']),
        id: z.string().uuid(),
        collectionId: z.string().uuid(),
        bodyPreview: z.string(),
      }),
    ),
    feedbackCount: z.number().int().nonnegative(),
  }),
  jobId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type MemoryRevision = z.infer<typeof memoryRevisionSchema>;
