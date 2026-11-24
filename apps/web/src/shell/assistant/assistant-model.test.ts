import { describe, expect, it } from 'vitest';
import { assistantModelOptionLabel, resolveAssistantModelId } from './assistant-model';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('resolveAssistantModelId', () => {
  const configs = [
    { id: A, isDefault: false },
    { id: B, isDefault: true },
  ];

  it('keeps a stored id that is still in the list', () => {
    expect(resolveAssistantModelId(A, configs)).toBe(A);
  });

  it('falls back to the default, then nothing', () => {
    expect(resolveAssistantModelId('gone', configs)).toBe(B);
    expect(resolveAssistantModelId(null, [])).toBeNull();
  });
});

describe('assistantModelOptionLabel', () => {
  it('uses the model name, and the provider when two configs share it', () => {
    expect(
      assistantModelOptionLabel(
        { provider: 'dashscope', model: 'qwen-plus', isDefault: true },
        [{ provider: 'dashscope', model: 'qwen-plus' }],
      ),
    ).toBe('qwen-plus');
    const shared = [
      { provider: 'dashscope' as const, model: 'qwen-plus' },
      { provider: 'openai' as const, model: 'qwen-plus' },
    ];
    expect(
      assistantModelOptionLabel({ provider: 'openai', model: 'qwen-plus', isDefault: false }, shared),
    ).toBe('OpenAI · qwen-plus');
  });

  it('marks the default when there is more than one config', () => {
    const configs = [
      { provider: 'dashscope' as const, model: 'qwen-plus', isDefault: true },
      { provider: 'zhipu' as const, model: 'glm-5', isDefault: false },
    ];
    expect(assistantModelOptionLabel(configs[0]!, configs)).toBe('qwen-plus · 默认');
  });
});
