/**
 * A failure the job has already accounted for (domain state updated, no retry
 * worthwhile). The queue records it as a terminal failure instead of retrying.
 */
export class AgentTerminalError extends Error {
  readonly terminal = true;

  constructor(
    message: string,
    readonly resultSummary: string | null = null,
  ) {
    super(message);
    this.name = 'AgentTerminalError';
  }
}
