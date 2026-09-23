import type { AgentExecutionStep, AgentExecutionStatus, AgentExecutionTurn, AgentType } from '@inwit/dto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentExecutions } from '../db/schema.js';
import { logger } from '../utils/logger.js';

export async function startExecution(input: {
  jobId: string;
  userId: string;
  agentType: AgentType;
}): Promise<string> {
  const [row] = await getDb()
    .insert(agentExecutions)
    .values({
      jobId: input.jobId,
      userId: input.userId,
      agentType: input.agentType,
      status: 'running',
    })
    .returning({ id: agentExecutions.id });
  if (!row) throw new Error('failed to insert agent_executions');
  return row.id;
}

export async function saveExecutionSteps(executionId: string, steps: AgentExecutionStep[]): Promise<void> {
  try {
    await getDb().update(agentExecutions).set({ steps }).where(eq(agentExecutions.id, executionId));
  } catch (err) {
    logger.error('agent.execution.steps_failed', err);
  }
}

export async function saveExecutionTurns(
  executionId: string,
  turns: AgentExecutionTurn[],
): Promise<void> {
  try {
    await getDb().update(agentExecutions).set({ turns }).where(eq(agentExecutions.id, executionId));
  } catch (err) {
    logger.error('agent.execution.turns_failed', err);
  }
}

export async function finishExecution(input: {
  executionId: string;
  status: AgentExecutionStatus;
  error?: string | null;
  resultSummary?: string | null;
}): Promise<void> {
  try {
    await getDb()
      .update(agentExecutions)
      .set({
        status: input.status,
        finishedAt: new Date(),
        error: input.error ?? null,
        resultSummary: input.resultSummary ?? null,
      })
      .where(eq(agentExecutions.id, input.executionId));
  } catch (err) {
    logger.error('agent.execution.finalize_failed', err);
  }
}

function auditText(value: unknown): string {
  if (value === undefined || value === null) return '';
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'object' && value !== null && 'content' in value) {
    const content = (value as { content?: unknown }).content;
    if (Array.isArray(content)) {
      text = content
        .map((block) => {
          if (typeof block === 'object' && block !== null && 'text' in block) {
            return typeof (block as { text?: unknown }).text === 'string'
              ? (block as { text: string }).text
              : '';
          }
          return '';
        })
        .join(' ');
    } else {
      text = JSON.stringify(value);
    }
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Character length of a tool payload before the stored summary is clipped. */
export function measureValue(value: unknown): number {
  return auditText(value).length;
}

export function summarizeValue(value: unknown, max = 400): string {
  const collapsed = auditText(value);
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
