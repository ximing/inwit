import {
  LLM_PROVIDERS,
  PROVIDER_BASE_URLS,
  PROVIDER_LABELS,
  PROVIDER_MODEL_OPTIONS,
  PROVIDER_MODELS,
} from '@inwit/dto';
import { describe, expect, it } from 'vitest';
import { DASHSCOPE_COMPATIBLE_BASE_URL, openaiCompatModel } from './pi.js';

describe('llm provider catalog', () => {
  it('gives every provider a label, official URL, and a default model that is also a suggestion', () => {
    for (const provider of LLM_PROVIDERS) {
      expect(PROVIDER_LABELS[provider].length).toBeGreaterThan(0);
      expect(PROVIDER_BASE_URLS[provider].startsWith('https://')).toBe(true);
      expect(PROVIDER_MODEL_OPTIONS[provider]).toContain(PROVIDER_MODELS[provider]);
    }
    expect(PROVIDER_BASE_URLS.dashscope).toBe(DASHSCOPE_COMPATIBLE_BASE_URL);
    expect(PROVIDER_BASE_URLS.kimi).toBe('https://api.moonshot.cn/v1');
    expect(PROVIDER_BASE_URLS.gemini).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(PROVIDER_LABELS.xai).toBe('Grok');
    expect(PROVIDER_LABELS.doubao).toBe('豆包');
  });

  it('forces Moonshot request fields for Kimi, including a custom base URL', () => {
    const model = openaiCompatModel('kimi', 'kimi-k3', 'https://proxy.example/v1');
    expect(model.provider).toBe('kimi');
    expect(model.baseUrl).toBe('https://proxy.example/v1');
    expect(model.compat?.maxTokensField).toBe('max_tokens');
    expect(model.compat?.supportsStore).toBe(false);
    expect(model.compat?.supportsDeveloperRole).toBe(false);
    expect(model.contextWindow).toBe(1_048_576);
    expect(model.maxTokens).toBe(131_072);
  });

  it('leaves other providers to URL auto-detect', () => {
    const dashscope = openaiCompatModel('dashscope', 'qwen-plus', DASHSCOPE_COMPATIBLE_BASE_URL);
    const gemini = openaiCompatModel('gemini', 'gemini-2.5-flash', PROVIDER_BASE_URLS.gemini);
    expect(dashscope.compat).toBeUndefined();
    expect(gemini.compat).toBeUndefined();
    expect(gemini.id).toBe('gemini-2.5-flash');
  });
});
