import { z } from 'zod';

/** Objects the signed-in account can see in 设置 → 文件. */
export const STORAGE_FILE_KINDS = ['source', 'media', 'excerpt', 'avatar'] as const;
export const storageFileKindSchema = z.enum(STORAGE_FILE_KINDS);
export type StorageFileKind = z.infer<typeof storageFileKindSchema>;

export const STORAGE_FILE_SORTS = ['modified', 'size'] as const;
export const storageFileSortSchema = z.enum(STORAGE_FILE_SORTS);
export type StorageFileSort = z.infer<typeof storageFileSortSchema>;

export const STORAGE_FILE_PREVIEWS = ['image', 'video'] as const;
export const storageFilePreviewSchema = z.enum(STORAGE_FILE_PREVIEWS);
export type StorageFilePreview = z.infer<typeof storageFilePreviewSchema>;

export const STORAGE_FILE_REF_TYPES = ['document', 'card', 'annotation', 'canvas', 'avatar'] as const;
export const storageFileRefTypeSchema = z.enum(STORAGE_FILE_REF_TYPES);
export type StorageFileRefType = z.infer<typeof storageFileRefTypeSchema>;

export const STORAGE_FILE_PAGE_LIMIT = 24;
/** Stop listing one prefix after this many objects and tell the client the page is incomplete. */
export const STORAGE_FILE_PREFIX_CAP = 2000;

export const storageFileRefSchema = z.object({
  type: storageFileRefTypeSchema,
  id: z.string().uuid(),
  title: z.string(),
  documentId: z.string().uuid().nullable(),
  archived: z.boolean(),
});
export type StorageFileRef = z.infer<typeof storageFileRefSchema>;

export const storageFileSchema = z.object({
  key: z.string(),
  kind: storageFileKindSchema,
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string().datetime().nullable(),
  ext: z.string(),
  preview: storageFilePreviewSchema.nullable(),
  unused: z.boolean(),
  refs: z.array(storageFileRefSchema),
});
export type StorageFile = z.infer<typeof storageFileSchema>;

export const storageFileViewSchema = storageFileSchema.extend({
  previewUrl: z.string().nullable(),
});
export type StorageFileView = z.infer<typeof storageFileViewSchema>;

export const storageFileKindSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
export type StorageFileKindSummary = z.infer<typeof storageFileKindSummarySchema>;

export const storageFilesSummarySchema = z.object({
  totalCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  byKind: z.object({
    source: storageFileKindSummarySchema,
    media: storageFileKindSummarySchema,
    excerpt: storageFileKindSummarySchema,
    avatar: storageFileKindSummarySchema,
  }),
});
export type StorageFilesSummary = z.infer<typeof storageFilesSummarySchema>;

export const storageFilesQuerySchema = z.object({
  kind: z.enum(['all', ...STORAGE_FILE_KINDS]).default('all'),
  unused: z.enum(['0', '1']).default('0'),
  sort: storageFileSortSchema.default('modified'),
  limit: z.coerce.number().int().min(1).max(100).default(STORAGE_FILE_PAGE_LIMIT),
  offset: z.coerce.number().int().min(0).default(0),
});
export type StorageFilesQuery = z.infer<typeof storageFilesQuerySchema>;

export const storageFilesResponseSchema = z.object({
  configured: z.boolean(),
  truncated: z.boolean(),
  summary: storageFilesSummarySchema,
  items: z.array(storageFileViewSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});
export type StorageFilesResponse = z.infer<typeof storageFilesResponseSchema>;
