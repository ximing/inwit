import { describe, expect, it } from 'vitest';
import { AgentTerminalError } from '../agent/terminal-error.js';
import { backoffMs, failureDisposition } from './queue-logic.js';

describe('failureDisposition', () => {
  it('treats AgentTerminalError as terminal regardless of attempts', () => {
    expect(failureDisposition(new AgentTerminalError('no cards'), 1, 4)).toBe('terminal');
    expect(failureDisposition(new AgentTerminalError('no cards'), 4, 4)).toBe('terminal');
  });

  it('retries ordinary errors until attempts run out', () => {
    expect(failureDisposition(new Error('boom'), 1, 4)).toBe('retry');
    expect(failureDisposition(new Error('boom'), 3, 4)).toBe('retry');
  });

  it('settles ordinary errors as exhausted at max attempts', () => {
    expect(failureDisposition(new Error('boom'), 4, 4)).toBe('exhausted');
    expect(failureDisposition(new Error('boom'), 5, 4)).toBe('exhausted');
  });

  it('treats non-Error throws like ordinary errors', () => {
    expect(failureDisposition('boom', 1, 4)).toBe('retry');
  });
});

describe('backoffMs', () => {
  const STEPS = [2_000, 8_000, 32_000] as const;

  it('walks the steps by attempt', () => {
    expect(backoffMs(1, STEPS)).toBe(2_000);
    expect(backoffMs(2, STEPS)).toBe(8_000);
    expect(backoffMs(3, STEPS)).toBe(32_000);
  });

  it('clamps to the last step beyond the schedule', () => {
    expect(backoffMs(10, STEPS)).toBe(32_000);
  });

  it('clamps zero/negative attempts to the first step', () => {
    expect(backoffMs(0, STEPS)).toBe(2_000);
  });
});
