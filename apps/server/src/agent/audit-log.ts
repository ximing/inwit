import { and, inArray, lt } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { agentExecutions, jobs, llmUsageLogs } from '../db/schema.js';
import { agentLogCutoff, PRUNABLE_LOG_STATUSES } from './audit-log-logic.js';

export interface AgentLogPruneCounts {
  executions: number;
  usageLogs: number;
  jobs: number;
}

/**
 * Delete settled agent executions, token-usage rows, and finished jobs older
 * than the retention window. In-flight jobs and their executions stay.
 * Usage rows are removed on their own age so a deleted execution does not
 * have to take the billing history with it in the same statement.
 */
export async function pruneAgentLogs(now = new Date()): Promise<AgentLogPruneCounts> {
  const cutoff = agentLogCutoff(now);
  const db = getDb();
  const settled = [...PRUNABLE_LOG_STATUSES];

  const usageLogs = await db
    .delete(llmUsageLogs)
    .where(lt(llmUsageLogs.createdAt, cutoff))
    .returning({ id: llmUsageLogs.id });

  const executions = await db
    .delete(agentExecutions)
    .where(
      and(inArray(agentExecutions.status, settled), lt(agentExecutions.startedAt, cutoff)),
    )
    .returning({ id: agentExecutions.id });

  const finishedJobs = await db
    .delete(jobs)
    .where(and(inArray(jobs.status, settled), lt(jobs.createdAt, cutoff)))
    .returning({ id: jobs.id });

  return {
    executions: executions.length,
    usageLogs: usageLogs.length,
    jobs: finishedJobs.length,
  };
}
