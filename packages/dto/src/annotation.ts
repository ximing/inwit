import { z } from 'zod';

export const ANNOTATION_KINDS = ['text', 'pdf', 'media'] as const;
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Annotation = z.infer<typeof annotationSchema>;

export const createAnnotationInputSchema = z
  .object({
    documentId: z.string().uuid(),
    quote: z.string().trim().min(1).max(20_000),
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
