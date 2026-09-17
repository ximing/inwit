import { z } from 'zod';
import { annotationKindSchema } from './annotation.js';
import { cardSchema } from './card.js';

export const ANNOTATION_RESURFACE_KEY_PREFIX = 'annotation_resurface_';
export const ANNOTATION_RESURFACE_AGE_DAYS = 14;
export const ANNOTATION_RESURFACE_MAX_ITEMS = 3;

export const ANNOTATION_RESURFACE_STATUSES = ['pending', 'accepted', 'dismissed'] as const;
export const annotationResurfaceStatusSchema = z.enum(ANNOTATION_RESURFACE_STATUSES);
export type AnnotationResurfaceStatus = z.infer<typeof annotationResurfaceStatusSchema>;

/** Memory row content for one day's resurface suggestion (scope=user, layer=profile). */
export const annotationResurfaceContentSchema = z.object({
  annotationIds: z.array(z.string().uuid()).min(1).max(ANNOTATION_RESURFACE_MAX_ITEMS),
  status: annotationResurfaceStatusSchema,
  dismissedAt: z.string().optional(),
  acceptedCardIds: z.array(z.string().uuid()).optional(),
});
export type AnnotationResurfaceContent = z.infer<typeof annotationResurfaceContentSchema>;

/** One suggested annotation, display-ready. */
export const annotationResurfaceItemSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  documentTitle: z.string().nullable(),
  kind: annotationKindSchema,
  quote: z.string(),
  note: z.string(),
  pageIndex: z.number().int().nullable(),
});
export type AnnotationResurfaceItem = z.infer<typeof annotationResurfaceItemSchema>;

export const annotationResurfaceSchema = z.object({
  key: z.string().min(1),
  status: annotationResurfaceStatusSchema,
  createdAt: z.string(),
  annotations: z.array(annotationResurfaceItemSchema).min(1),
});
export type AnnotationResurface = z.infer<typeof annotationResurfaceSchema>;

export const annotationResurfaceResponseSchema = z.object({
  resurface: annotationResurfaceSchema.nullable(),
});
export type AnnotationResurfaceResponse = z.infer<typeof annotationResurfaceResponseSchema>;

export const acceptAnnotationResurfaceInputSchema = z.object({
  annotationId: z.string().uuid(),
});
export type AcceptAnnotationResurfaceInput = z.infer<typeof acceptAnnotationResurfaceInputSchema>;

export const acceptAnnotationResurfaceResponseSchema = z.object({
  card: cardSchema,
  resurface: annotationResurfaceSchema.nullable(),
});
export type AcceptAnnotationResurfaceResponse = z.infer<
  typeof acceptAnnotationResurfaceResponseSchema
>;
