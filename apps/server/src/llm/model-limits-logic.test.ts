import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_LIMITS,
  GLM5_MODEL_LIMITS,
  KIMI_K3_MODEL_LIMITS,
  QWEN_PLUS_LIMITS,
  QWEN3_LONG_LIMITS,
  resolveModelLimits,
} from './model-limits-logic.js';

describe('resolveModelLimits', () => {
  it('gives GLM-5 a 1M context and 128K output so thinking does not eat the whole reply', () => {
    expect(resolveModelLimits('glm-5.3-flash')).toEqual(GLM5_MODEL_LIMITS);
    expect(resolveModelLimits('GLM-5.3-Flash')).toEqual(GLM5_MODEL_LIMITS);
    expect(resolveModelLimits('zhipu/glm-5.3-flash')).toEqual(GLM5_MODEL_LIMITS);
    expect(GLM5_MODEL_LIMITS.contextWindow).toBe(1_048_576);
    expect(GLM5_MODEL_LIMITS.maxOutputTokens).toBe(131_072);
  });

  it('gives kimi-k3 the 1M context window and the default 128K output cap', () => {
    expect(resolveModelLimits('kimi-k3')).toEqual(KIMI_K3_MODEL_LIMITS);
    expect(resolveModelLimits('Kimi-K3')).toEqual(KIMI_K3_MODEL_LIMITS);
    expect(resolveModelLimits('moonshot/kimi-k3')).toEqual(KIMI_K3_MODEL_LIMITS);
    expect(KIMI_K3_MODEL_LIMITS.contextWindow).toBe(1_048_576);
    expect(KIMI_K3_MODEL_LIMITS.maxOutputTokens).toBe(131_072);
    expect(resolveModelLimits('kimi-k2.6')).toEqual(DEFAULT_MODEL_LIMITS);
  });

  it('gives current Qwen long-context models their published output cap', () => {
    expect(resolveModelLimits('qwen-plus')).toEqual(QWEN_PLUS_LIMITS);
    expect(resolveModelLimits('qwen-flash-latest')).toEqual(QWEN_PLUS_LIMITS);
    expect(resolveModelLimits('qwen3.7-plus')).toEqual(QWEN3_LONG_LIMITS);
    expect(resolveModelLimits('qwen-plus-character')).toEqual(DEFAULT_MODEL_LIMITS);
  });

  it('keeps smaller models on the conservative default', () => {
    expect(resolveModelLimits('glm-4')).toEqual(DEFAULT_MODEL_LIMITS);
    expect(resolveModelLimits('gpt-4o-mini')).toEqual(DEFAULT_MODEL_LIMITS);
    expect(resolveModelLimits('qwen-max')).toEqual(DEFAULT_MODEL_LIMITS);
    expect(resolveModelLimits('  ')).toEqual(DEFAULT_MODEL_LIMITS);
  });
});
