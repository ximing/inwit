import { z } from 'zod';

export const MEMORY_SCOPES = ['user', 'topic'] as const;
export const memoryScopeSchema = z.enum(MEMORY_SCOPES);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const MEMORY_LAYERS = ['profile', 'mastery', 'association', 'topic_map'] as const;
export const memoryLayerSchema = z.enum(MEMORY_LAYERS);
export type MemoryLayer = z.infer<typeof memoryLayerSchema>;

export const memoryContentSchema = z.record(z.string(), z.unknown());
export type MemoryContent = z.infer<typeof memoryContentSchema>;

export const memorySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  scope: memoryScopeSchema,
  scopeId: z.string().uuid().nullable(),
  layer: memoryLayerSchema,
  key: z.string().min(1).max(200),
  content: memoryContentSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Memory = z.infer<typeof memorySchema>;
