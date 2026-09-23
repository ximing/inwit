import { describe, expect, it } from 'vitest';
import {
  AGENT_LOG_RETENTION_MS,
  agentLogCutoff,
  isPrunableLogStatus,
} from './audit-log-logic.js';

describe('agentLogCutoff', () => {
  it('is exactly the retention window before now', () => {
    const now = new Date('2026-09-22T10:32:57.849Z');
    expect(agentLogCutoff(now).toISOString()).toBe(
      new Date(now.getTime() - AGENT_LOG_RETENTION_MS).toISOString(),
    );
    expect(now.getTime() - agentLogCutoff(now).getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('isPrunableLogStatus', () => {
  it('drops settled rows and keeps work still in flight', () => {
    expect(isPrunableLogStatus('done')).toBe(true);
    expect(isPrunableLogStatus('failed')).toBe(true);
    expect(isPrunableLogStatus('pending')).toBe(false);
    expect(isPrunableLogStatus('running')).toBe(false);
  });
});
