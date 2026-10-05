import { z } from 'zod';

export const ANNOTATION_KINDS = ['text', 'pdf', 'media', 'note'] as const;
export const annotationKindSchema = z.enum(ANNOTATION_KINDS);
export type AnnotationKind = z.infer<typeof annotationKindSchema>;

/** PDF user-space quads; not viewer-library native format. */
export const annotationGeometrySchema = z.object({
  quads: z.array(z.array(z.number())),
  color: z.string().optional(),
});
export type AnnotationGeometry = z.infer<typeof annotationGeometrySchema>;

const PDF_REQUIRED_FIELDS = ['pageIndex', 'geometry'] as const;
const TEXT_FORBIDDEN_FIELDS = ['pageIndex', 'geometry', 'imageKey', 'positionMs'] as const;
const NON_TEXT_FORBIDDEN_FIELDS = ['anchorBlockIndex'] as const;
const NOTE_FORBIDDEN_FIELDS = ['pageIndex', 'geometry', 'positionMs'] as const;

export const annotationSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  quote: z.string(),
  note: z.string(),
  kind: annotationKindSchema,
  pageIndex: z.number().int().nullable(),
  anchorBlockIndex: z.number().int().nullable(),
  geometry: annotationGeometrySchema.nullable(),
  imageKey: z.string().nullable(),
  positionMs: z.number().int().nullable(),
  /** Derived: this annotation has already been converted into a card. */
  hasConvertedCard: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type Annotation = z.infer<typeof annotationSchema>;

/** Soft-deleted annotation row for the settings 回收站. */
export const archivedAnnotationSchema = annotationSchema.extend({
  documentTitle: z.string().nullable(),
});
export type ArchivedAnnotation = z.infer<typeof archivedAnnotationSchema>;

export const archivedAnnotationsResponseSchema = z.object({
  items: z.array(archivedAnnotationSchema),
  total: z.number().int().nonnegative(),
});
export type ArchivedAnnotationsResponse = z.infer<typeof archivedAnnotationsResponseSchema>;

export const createAnnotationInputSchema = z
  .object({
    documentId: z.string().uuid(),
    /** 正文选段。kind='note'（无锚点想法）必须缺省或为空，其它 kind 必填。 */
    quote: z.string().trim().max(20_000).optional(),
    note: z.string().max(20_000).optional(),
    kind: annotationKindSchema.optional(),
    pageIndex: z.number().int().nonnegative().optional(),
    geometry: annotationGeometrySchema.optional(),
    imageKey: z.string().min(1).optional(),
    positionMs: z.number().int().nonnegative().optional(),
    anchorBlockIndex: z.number().int().positive().optional(),
  })
  .superRefine((value, ctx) => {
    const kind = value.kind ?? 'text';
    if (kind === 'note') {
      // 想法：无锚点。quote 必须空，note 与 imageKey 至少其一，软锚点 anchorBlockIndex 可带。
      if (value.quote !== undefined && value.quote !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['quote'],
          message: 'quote must be empty when kind is note',
        });
      }
      if ((value.note === undefined || value.note.trim() === '') && !value.imageKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['note'],
          message: 'note or imageKey required when kind is note',
        });
      }
      for (const field of NOTE_FORBIDDEN_FIELDS) {
        if (value[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is not allowed when kind is note`,
          });
        }
      }
      return;
    }
    if (value.quote === undefined || value.quote === '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quote'],
        message: 'quote is required',
      });
    }
    if (kind === 'pdf') {
      for (const field of PDF_REQUIRED_FIELDS) {
        if (value[field] == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} required when kind is pdf`,
          });
        }
      }
      for (const field of NON_TEXT_FORBIDDEN_FIELDS) {
        if (value[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is not allowed when kind is pdf`,
          });
        }
      }
      return;
    }
    if (kind === 'media') {
      for (const field of NON_TEXT_FORBIDDEN_FIELDS) {
        if (value[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is not allowed when kind is media`,
          });
        }
      }
      return;
    }
    if (kind !== 'text') return;
    for (const field of TEXT_FORBIDDEN_FIELDS) {
      if (value[field] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is not allowed when kind is text`,
        });
      }
    }
  });
export type CreateAnnotationInput = z.infer<typeof createAnnotationInputSchema>;

export const updateAnnotationInputSchema = z.object({
  note: z.string().max(20_000),
});
export type UpdateAnnotationInput = z.infer<typeof updateAnnotationInputSchema>;

export const annotationImageResponseSchema = z.object({
  url: z.string().url(),
});
export type AnnotationImageResponse = z.infer<typeof annotationImageResponseSchema>;

/** Placeholder quote for a box-select excerpt that has no OCR text yet. */
export const IMAGE_EXCERPT_QUOTE = '[图片摘录]';
