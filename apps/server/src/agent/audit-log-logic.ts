/** Finished agent logs, usage rows, and settled jobs are kept this long. */
export const AGENT_LOG_RETENTION_DAYS = 30;
export const AGENT_LOG_RETENTION_MS = AGENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Statuses safe to delete. Pending and running work stays. */
export const PRUNABLE_LOG_STATUSES = ['done', 'failed'] as const;
export type PrunableLogStatus = (typeof PRUNABLE_LOG_STATUSES)[number];

export function agentLogCutoff(now = new Date(), retentionMs = AGENT_LOG_RETENTION_MS): Date {
  return new Date(now.getTime() - retentionMs);
}

export function isPrunableLogStatus(status: string): status is PrunableLogStatus {
  return (PRUNABLE_LOG_STATUSES as readonly string[]).includes(status);
}
