import { formatAgentTurn } from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { outputLimitSummary, summarizeAssistantTurn, type AssistantTurnSource } from './turn-audit-logic.js';

function message(overrides: Partial<AssistantTurnSource> = {}): AssistantTurnSource {
  return {
    provider: 'zhipu',
    model: 'glm-5.3-flash',
    stopReason: 'stop',
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
    },
    content: [],
    ...overrides,
  };
}

describe('summarizeAssistantTurn', () => {
  it('flags a turn that spends the whole output budget on thinking and calls no tools', () => {
    const thinking = '先把全文拆成概念。'.repeat(40);
    const turn = summarizeAssistantTurn({
      phase: 'run',
      index: 1,
      maxTokens: 8192,
      message: message({
        stopReason: 'length',
        rawStopReason: 'length',
        usage: {
          input: 19000,
          output: 8192,
          cacheRead: 1000,
          cacheWrite: 227,
          reasoning: 8192,
          totalTokens: 28419,
        },
        content: [{ type: 'thinking', thinking }],
      }),
    });

    expect(turn.hit_output_limit).toBe(true);
    expect(turn.prompt_tokens).toBe(20227);
    expect(turn.completion_tokens).toBe(8192);
    expect(turn.reasoning_tokens).toBe(8192);
    expect(turn.text_chars).toBe(0);
    expect(turn.reasoning_chars).toBe(thinking.length);
    expect(turn.tool_calls).toEqual([]);
    expect(turn.reasoning_tail.startsWith('…')).toBe(true);
    expect(turn.reasoning_tail.length).toBeLessThanOrEqual(181);
    expect(outputLimitSummary([turn])).toBe('output_limit=run#2:8192/8192');
  });

  it('records visible text and tool names when the model stops to call tools', () => {
    const turn = summarizeAssistantTurn({
      phase: 'run',
      index: 0,
      maxTokens: 8192,
      message: message({
        stopReason: 'toolUse',
        usage: { input: 2806, output: 209, cacheRead: 0, cacheWrite: 0, totalTokens: 3015 },
        content: [
          { type: 'text', text: '我先读取原文和你的批注。' },
          { type: 'toolCall', name: 'read_document' },
          { type: 'toolCall', name: 'read_document_annotations' },
        ],
      }),
    });

    expect(turn.hit_output_limit).toBe(false);
    expect(turn.text_tail).toBe('我先读取原文和你的批注。');
    expect(turn.tool_calls).toEqual(['read_document', 'read_document_annotations']);
    expect(turn.reasoning_tokens).toBeNull();
    expect(formatAgentTurn(turn)).toContain('模型 #1');
    expect(formatAgentTurn(turn)).toContain('工具 read_document、read_document_annotations');
  });

  it('labels a nudge turn and clips a long provider error', () => {
    const turn = summarizeAssistantTurn({
      phase: 'nudge',
      index: 2,
      maxTokens: null,
      message: message({
        stopReason: 'error',
        errorMessage: `x${'y'.repeat(400)}`,
        content: [],
      }),
    });

    expect(turn.phase).toBe('nudge');
    expect(turn.max_tokens).toBeNull();
    expect(turn.error).toHaveLength(301);
    expect(turn.error?.endsWith('…')).toBe(true);
    expect(formatAgentTurn(turn)).toContain('催办 #3');
    expect(outputLimitSummary([turn])).toBeNull();
  });
});
