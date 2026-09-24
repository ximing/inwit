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
  'memory_organize',
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
  /** Untruncated tool-result length. Absent on rows written before this field. */
  output_chars: z.number().int().nonnegative().optional(),
});
export type AgentExecutionStep = z.infer<typeof agentExecutionStepSchema>;

export const AGENT_TURN_PHASES = ['run', 'nudge'] as const;
export const agentTurnPhaseSchema = z.enum(AGENT_TURN_PHASES);
export type AgentTurnPhase = z.infer<typeof agentTurnPhaseSchema>;

/**
 * One assistant model turn, stored in agent_executions.turns.
 * Tails are clipped; the full completion is not retained.
 */
export const agentExecutionTurnSchema = z.object({
  phase: agentTurnPhaseSchema,
  index: z.number().int().nonnegative(),
  provider: z.string(),
  model: z.string(),
  stop_reason: z.string(),
  raw_stop_reason: z.string().nullable(),
  error: z.string().nullable(),
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  reasoning_tokens: z.number().int().nonnegative().nullable(),
  max_tokens: z.number().int().positive().nullable(),
  text_chars: z.number().int().nonnegative(),
  reasoning_chars: z.number().int().nonnegative(),
  text_tail: z.string(),
  reasoning_tail: z.string(),
  tool_calls: z.array(z.string()),
  hit_output_limit: z.boolean(),
});
export type AgentExecutionTurn = z.infer<typeof agentExecutionTurnSchema>;

export function formatAgentTurn(turn: AgentExecutionTurn): string {
  const phase = turn.phase === 'nudge' ? '催办' : '模型';
  const cap = turn.max_tokens != null ? `/${String(turn.max_tokens)}` : '';
  const reasoning =
    turn.reasoning_tokens != null ? ` · 推理 ${String(turn.reasoning_tokens)} token` : '';
  const thinking = turn.reasoning_chars > 0 ? ` · 思考 ${String(turn.reasoning_chars)} 字` : '';
  const tools = turn.tool_calls.length > 0 ? turn.tool_calls.join('、') : '无';
  const limit = turn.hit_output_limit ? ' · 输出顶满上限' : '';
  const error = turn.error ? ` · ${turn.error}` : '';
  return `${phase} #${String(turn.index + 1)} · ${turn.stop_reason} · 输入 ${String(turn.prompt_tokens)} · 输出 ${String(turn.completion_tokens)}${cap}${reasoning}${thinking} · 正文 ${String(turn.text_chars)} 字 · 工具 ${tools}${limit}${error}`;
}

export const agentExecutionSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid().nullable(),
  userId: z.string().uuid(),
  agentType: agentTypeSchema,
  status: agentExecutionStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(agentExecutionStepSchema),
  turns: z.array(agentExecutionTurnSchema).default(() => []),
  error: z.string().nullable(),
  resultSummary: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentExecution = z.infer<typeof agentExecutionSchema>;
