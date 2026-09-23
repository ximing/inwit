import type { AgentExecutionTurn, AgentTurnPhase } from '@inwit/dto';

const TAIL_MAX = 180;
const ERROR_MAX = 300;

export interface AssistantTurnSource {
  provider: string;
  model: string;
  stopReason: string;
  rawStopReason?: string | undefined;
  errorMessage?: string | undefined;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number | undefined;
    totalTokens: number;
  };
  content: readonly unknown[];
}

function nonNeg(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function clipTail(value: string, max = TAIL_MAX): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `…${collapsed.slice(-max)}`;
}

function clipError(value: string | undefined): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > ERROR_MAX ? `${collapsed.slice(0, ERROR_MAX)}…` : collapsed;
}

function readBlocks(content: readonly unknown[]): {
  text: string;
  reasoning: string;
  tools: string[];
} {
  let text = '';
  let reasoning = '';
  const tools: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const rec = block as { type?: unknown; text?: unknown; thinking?: unknown; name?: unknown };
    if (rec.type === 'text' && typeof rec.text === 'string') text += rec.text;
    else if (rec.type === 'thinking' && typeof rec.thinking === 'string') reasoning += rec.thinking;
    else if (rec.type === 'toolCall' && typeof rec.name === 'string' && rec.name.length > 0) {
      tools.push(rec.name);
    }
  }
  return { text, reasoning, tools };
}

/** Compact record of one assistant turn for agent_executions.turns. */
export function summarizeAssistantTurn(input: {
  phase: AgentTurnPhase;
  index: number;
  maxTokens: number | null;
  message: AssistantTurnSource;
}): AgentExecutionTurn {
  const { message } = input;
  const usage = message.usage;
  const blocks = readBlocks(message.content);
  const completionTokens = nonNeg(usage.output);
  const maxTokens =
    input.maxTokens != null && Number.isFinite(input.maxTokens) && input.maxTokens > 0
      ? Math.round(input.maxTokens)
      : null;
  const reasoningTokens =
    typeof usage.reasoning === 'number' && Number.isFinite(usage.reasoning)
      ? nonNeg(usage.reasoning)
      : null;
  return {
    phase: input.phase,
    index: input.index,
    provider: message.provider,
    model: message.model,
    stop_reason: message.stopReason,
    raw_stop_reason: message.rawStopReason?.trim() ? message.rawStopReason.trim() : null,
    error: clipError(message.errorMessage),
    prompt_tokens: nonNeg(usage.input) + nonNeg(usage.cacheRead) + nonNeg(usage.cacheWrite),
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    max_tokens: maxTokens,
    text_chars: blocks.text.length,
    reasoning_chars: blocks.reasoning.length,
    text_tail: clipTail(blocks.text),
    reasoning_tail: clipTail(blocks.reasoning),
    tool_calls: blocks.tools,
    hit_output_limit:
      message.stopReason === 'length' || (maxTokens != null && completionTokens >= maxTokens),
  };
}

/** Appended to a failed execution summary when a turn exhausted the output budget. */
export function outputLimitSummary(turns: readonly AgentExecutionTurn[]): string | null {
  const hits = turns.filter((turn) => turn.hit_output_limit);
  if (hits.length === 0) return null;
  const parts = hits.map(
    (turn) =>
      `${turn.phase}#${String(turn.index + 1)}:${String(turn.completion_tokens)}/${turn.max_tokens != null ? String(turn.max_tokens) : '?'}`,
  );
  return `output_limit=${parts.join(',')}`;
}
