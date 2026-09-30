import { z } from 'zod';

export const SYNC_SCOPES = [
  'document',
  'topic',
  'map',
  'review',
  'job',
  'report',
  'suggest',
  'resurface',
] as const;
export const syncScopeSchema = z.enum(SYNC_SCOPES);
export type SyncScope = z.infer<typeof syncScopeSchema>;

export const SYNC_OPS = ['upsert', 'delete'] as const;
export const syncOpSchema = z.enum(SYNC_OPS);
export type SyncOp = z.infer<typeof syncOpSchema>;

export const syncChangeSchema = z.object({
  id: z.string().regex(/^\d+$/),
  scope: z.enum(SYNC_SCOPES),
  resourceId: z.string().uuid().nullable(),
  op: z.enum(['upsert', 'delete']),
  at: z.string().datetime(),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncPollQuerySchema = z.object({
  since: z.string().regex(/^\d+$/).optional(),
});
export type SyncPollQuery = z.infer<typeof syncPollQuerySchema>;

export const syncPollResponseSchema = z.object({
  cursor: z.string().regex(/^\d+$/),
  reset: z.boolean(),
  more: z.boolean(),
  changes: z.array(syncChangeSchema).max(200),
});
export type SyncPollResponse = z.infer<typeof syncPollResponseSchema>;
