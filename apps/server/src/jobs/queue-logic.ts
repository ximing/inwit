import { AgentTerminalError } from '../agent/terminal-error.js';

export type FailureDisposition = 'terminal' | 'exhausted' | 'retry';

/**
 * Classifies a job failure: terminal failures settle as failed immediately,
 * everything else retries with backoff until attempts run out.
 */
export function failureDisposition(
  err: unknown,
  attempts: number,
  maxAttempts: number,
): FailureDisposition {
  if (err instanceof AgentTerminalError) return 'terminal';
  return attempts >= maxAttempts ? 'exhausted' : 'retry';
}

export function backoffMs(attempts: number, steps: readonly number[]): number {
  return steps[Math.min(Math.max(attempts - 1, 0), steps.length - 1)] ?? 32_000;
}
