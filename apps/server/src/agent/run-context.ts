import { AsyncLocalStorage } from 'node:async_hooks';

export interface AgentRunContext {
  userId: string;
  executionId: string;
  jobId: string;
  documentId?: string;
  topicId?: string;
}

const storage = new AsyncLocalStorage<AgentRunContext>();

export function currentAgentRun(): AgentRunContext | undefined {
  return storage.getStore();
}

export function runWithAgentContext<T>(ctx: AgentRunContext, work: () => Promise<T>): Promise<T> {
  return storage.run(ctx, work);
}
