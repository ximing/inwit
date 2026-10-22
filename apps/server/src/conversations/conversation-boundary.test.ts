import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('conversation service boundary', () => {
  const source = readFileSync(new URL('./conversation.service.ts', import.meta.url), 'utf8');

  it('does not import agent conversation logic', () => {
    expect(source).not.toContain('agent/conversation-logic');
  });

  it('does not import from agent', () => {
    expect(source).not.toContain('../agent/');
    expect(source).not.toContain('agent/conversation');
  });
});
