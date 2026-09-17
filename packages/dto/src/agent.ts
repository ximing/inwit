import { z } from 'zod';

export const AGENT_TYPES = [
  'digest',
  'evolve',
  'weekly_report',
  'topic',
  'chat',
  'selection',
  'extract',
  'ocr',
] as const;
export const agentTypeSchema = z.enum(AGENT_TYPES);
export type AgentType = z.infer<typeof agentTypeSchema>;

export const AGENT_EXECUTION_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export const agentExecutionStatusSchema = z.enum(AGENT_EXECUTION_STATUSES);
export type AgentExecutionStatus = z.infer<typeof agentExecutionStatusSchema>;

/** Stored in agent_executions.steps jsonb — keys match the DB document shape. */
export const agentExecutionStepSchema = z.object({
  tool: z.string().min(1),
  input_summary: z.string(),
  output_summary: z.string(),
  duration_ms: z.number().int().nonnegative(),
});
export type AgentExecutionStep = z.infer<typeof agentExecutionStepSchema>;

export const agentExecutionSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  agentType: agentTypeSchema,
  status: agentExecutionStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(agentExecutionStepSchema),
  error: z.string().nullable(),
  resultSummary: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentExecution = z.infer<typeof agentExecutionSchema>;
