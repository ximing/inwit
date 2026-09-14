import { z } from 'zod';
import { cardSummarySchema } from './card.js';

export const MAP_MAX_DEPTH = 3;

export const MAP_NODE_STATUSES = ['uncovered', 'learning', 'covered'] as const;
export const mapNodeStatusSchema = z.enum(MAP_NODE_STATUSES);
export type MapNodeStatus = z.infer<typeof mapNodeStatusSchema>;

/**
 * Stored node plus live stats.
 * `mastery` is the share of cards on this node whose latest review_states.last_feedback
 * is `remembered` (unreviewed cards count as 0). Range [0, 1]. Empty node → 0.
 */
export const mapNodeSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  title: z.string().min(1),
  status: mapNodeStatusSchema,
  note: z.string().nullable(),
  position: z.number().int(),
  createdAt: z.string(),
  cardCount: z.number().int().nonnegative(),
  docCount: z.number().int().nonnegative(),
  mastery: z.number().min(0).max(1),
});
export type MapNode = z.infer<typeof mapNodeSchema>;

export type MapTreeNode = MapNode & { children: MapTreeNode[] };

export const mapTreeNodeSchema: z.ZodType<MapTreeNode> = z.lazy(() =>
  mapNodeSchema.extend({
    children: z.array(mapTreeNodeSchema),
  }),
);

export const mapTreeSchema = z.object({
  nodes: z.array(mapTreeNodeSchema),
});
export type MapTree = { nodes: MapTreeNode[] };

export const mapSummarySchema = z.object({
  totalNodes: z.number().int().nonnegative(),
  uncoveredNodes: z.number().int().nonnegative(),
  cardCount: z.number().int().nonnegative(),
  /** 0–100. remembered ratio across all cards hung on this topic's map. */
  masteryPct: z.number().min(0).max(100),
});
export type MapSummary = z.infer<typeof mapSummarySchema>;

export const createMapNodeInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  parentId: z.string().uuid().optional(),
  note: z.string().max(4000).optional(),
});
export type CreateMapNodeInput = z.infer<typeof createMapNodeInputSchema>;

export const updateMapNodeInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    note: z.string().max(4000).nullable().optional(),
    parentId: z.string().uuid().nullable().optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.note !== undefined ||
      value.parentId !== undefined ||
      value.position !== undefined,
    { message: 'at least one of title, note, parentId, position is required' },
  );
export type UpdateMapNodeInput = z.infer<typeof updateMapNodeInputSchema>;

export const setMapNodeInputSchema = z.object({
  nodeId: z.string().uuid().nullable(),
});
export type SetMapNodeInput = z.infer<typeof setMapNodeInputSchema>;

export const mapNodeDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(['pending', 'digested', 'failed']),
  updatedAt: z.string(),
});
export type MapNodeDocument = z.infer<typeof mapNodeDocumentSchema>;

export const mapNodeDetailSchema = z.object({
  node: mapNodeSchema,
  cards: z.array(cardSummarySchema),
  documents: z.array(mapNodeDocumentSchema),
});
export type MapNodeDetail = z.infer<typeof mapNodeDetailSchema>;
