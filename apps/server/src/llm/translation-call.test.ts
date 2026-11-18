import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranslationModelSnapshot } from '@inwit/dto';
const state = vi.hoisted(() => ({ complete: vi.fn(), resolve: vi.fn() }));
vi.mock('./pi.js', () => ({ resolvedOf: state.resolve }));
import { completeTranslation } from './translation-call.js';
import { mergeProviderUsage, UNKNOWN_TRANSLATION_USAGE } from './translation-call-logic.js';
const model: TranslationModelSnapshot = {
  provider: 'openai',
  model: 'test',
  baseUrl: 'https://example.com',
  configId: '00000000-0000-4000-8000-000000000001',
  credentialVersionId: '00000000-0000-4000-8000-000000000002',
};
beforeEach(() => {
  vi.restoreAllMocks();
  state.complete.mockReset();
  state.resolve.mockReset().mockResolvedValue({
    model: { maxTokens: 100, contextWindow: 10000 },
    models: { completeSimple: state.complete },
  });
});
describe('raw provider translation usage', () => {
  it('does not invent zeroes for missing usage or missing counters', () => {
    expect(mergeProviderUsage(UNKNOWN_TRANSLATION_USAGE, {})).toEqual(UNKNOWN_TRANSLATION_USAGE);
    expect(mergeProviderUsage(UNKNOWN_TRANSLATION_USAGE, { usage: { prompt_tokens: 0 } })).toEqual({
      usageStatus: 'partial',
      inputTokens: 0,
      outputTokens: null,
      totalTokens: null,
    });
  });
  it('merges Anthropic message_start/message_delta preserving absent total', () => {
    const start = mergeProviderUsage(UNKNOWN_TRANSLATION_USAGE, {
      message: { usage: { input_tokens: 12, cache_read_input_tokens: 5 } },
    });
    expect(mergeProviderUsage(start, { usage: { output_tokens: 8 } })).toEqual({
      usageStatus: 'partial',
      inputTokens: 17,
      outputTokens: 8,
      totalTokens: null,
    });
  });
  it('never trusts the SDK synthesized zero usage', async () => {
    state.complete.mockResolvedValue({
      content: [{ type: 'text', text: '译文' }],
      stopReason: 'stop',
      usage: { input: 0, output: 0, totalTokens: 0 },
    });
    expect(await completeTranslation(model, 'secret', 'source')).toMatchObject({
      status: 'succeeded',
      text: '译文',
      usageStatus: 'unknown',
      inputTokens: null,
    });
  });
  it('captures real SSE usage and retains it on truncation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            'data: {"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}\n\n',
          ),
        ),
    );
    state.complete.mockImplementation(async (_m, _c, options) => {
      await (await options.fetch('https://example.com')).text();
      return { content: [], stopReason: 'length' };
    });
    expect(await completeTranslation(model, 'secret', 'source')).toMatchObject({
      status: 'failed',
      errorCode: 'LLM_OUTPUT_TRUNCATED',
      usageStatus: 'known',
      inputTokens: 8,
      outputTokens: 3,
      totalTokens: 11,
    });
    vi.unstubAllGlobals();
  });
  it('blocks SDK automatic HTTP retries and treats outcome as unknown', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network secret source'));
    vi.stubGlobal('fetch', fetch);
    state.complete.mockImplementation(async (_m, _c, options) => {
      try {
        await options.fetch('https://example.com');
      } catch {}
      await options.fetch('https://example.com');
    });
    const result = await completeTranslation(model, 'secret', 'source');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'unknown', usageStatus: 'unknown' });
    expect(JSON.stringify(result)).not.toContain('secret');
    vi.unstubAllGlobals();
  });
  it('bounds output by available context and drops optional context instead of reducing it', async () => {
    state.resolve.mockResolvedValue({
      model: { maxTokens: 10000, contextWindow: 10000 },
      models: { completeSimple: state.complete },
    });
    state.complete.mockImplementation(async (_model, context, options) => {
      expect(options.maxTokens).toBeGreaterThan(8192);
      expect(options.maxTokens).toBeLessThan(10000);
      expect(JSON.parse(context.messages[0].content).context).toBe('');
      return { content: [{ type: 'text', text: '译文' }], stopReason: 'stop' };
    });
    expect(
      await completeTranslation(model, 'secret', 'short source', 'neighbor'.repeat(100)),
    ).toMatchObject({ status: 'succeeded' });
  });
  it('accounts for JSON escapes before accepting input', async () => {
    state.resolve.mockResolvedValue({
      model: { maxTokens: 8192, contextWindow: 1000 },
      models: { completeSimple: state.complete },
    });
    expect(await completeTranslation(model, 'secret', '\u0000'.repeat(500))).toMatchObject({
      status: 'failed',
      errorCode: 'PDF_TRANSLATION_CONTEXT_TOO_LARGE',
    });
    expect(state.complete).not.toHaveBeenCalled();
  });
  it('rejects over-capacity input before any HTTP request', async () => {
    const result = await completeTranslation(model, 'secret', 'x'.repeat(50000));
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'PDF_TRANSLATION_CONTEXT_TOO_LARGE',
    });
    expect(state.complete).not.toHaveBeenCalled();
  });
});
