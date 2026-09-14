import { describe, expect, it } from 'vitest';
import { isChatQuestion } from '@inwit/dto';
import { extractAssistantText } from './messages.js';

describe('isChatQuestion', () => {
  it('detects trailing ascii and fullwidth question marks', () => {
    expect(isChatQuestion('L1 和 L2 有啥区别？')).toBe(true);
    expect(isChatQuestion('what is L2?')).toBe(true);
    expect(isChatQuestion('what is L2?  ')).toBe(true);
    expect(isChatQuestion('这不是问题')).toBe(false);
    expect(isChatQuestion('中间？还有下文')).toBe(false);
  });
});

describe('extractAssistantText', () => {
  it('joins non-empty assistant text turns and skips tool-only messages', () => {
    const text = extractAssistantText([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
        content: [{ type: 'text', text: '第一段回答' }],
      },
      {
        role: 'assistant',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
        content: [{ type: 'toolCall', id: '1', name: 'write_cards', arguments: {} }],
      },
      {
        role: 'assistant',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
        content: [{ type: 'text', text: '  补充一句  ' }],
      },
    ]);
    expect(text).toBe('第一段回答\n\n补充一句');
  });
});
