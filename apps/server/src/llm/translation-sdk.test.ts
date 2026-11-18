import { afterEach, describe, it, expect, vi } from 'vitest';
import type { TranslationModelSnapshot } from '@inwit/dto';
vi.mock('../net/public-url.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../net/public-url.js')>()),
  assertResolvedPublic: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));
import { completeTranslation } from './translation-call.js';
const model: TranslationModelSnapshot = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.example.com/v1',
  configId: '00000000-0000-4000-8000-000000000001',
  credentialVersionId: '00000000-0000-4000-8000-000000000002',
};
function sse(usage?: Record<string, number>) {
  return (
    [
      'data: ' +
        JSON.stringify({
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: model.model,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '实验没有提高准确率。' },
              finish_reason: null,
            },
          ],
        }),
      'data: ' +
        JSON.stringify({
          id: 'test',
          object: 'chat.completion.chunk',
          created: 1,
          model: model.model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
      ...(usage
        ? [
            'data: ' +
              JSON.stringify({
                id: 'test',
                object: 'chat.completion.chunk',
                created: 1,
                model: model.model,
                choices: [],
                usage,
              }),
          ]
        : []),
      'data: [DONE]',
    ].join('\n\n') + '\n\n'
  );
}
afterEach(() => vi.unstubAllGlobals());
describe('installed pi-ai SDK transport integration', () => {
  it('emits a text draft before the real SDK response finishes, retaining unknown usage', async () => {
    const parts = sse().split('\n\n');
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(parts.shift() + '\n\n'));
        finish = () => {
          controller.enqueue(new TextEncoder().encode(parts.join('\n\n')));
          controller.close();
        };
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetch);
    let first!: () => void;
    const firstDraft = new Promise<void>((resolve) => {
      first = resolve;
    });
    const drafts: string[] = [];
    let complete = false;
    const request = completeTranslation(model, 'local-test-only', 'source', '', (text) => {
      drafts.push(text);
      first();
    }).then((result) => {
      complete = true;
      return result;
    });
    await firstDraft;
    expect(complete).toBe(false);
    expect(drafts[0]).toBe('实验没有提高准确率。');
    finish();
    expect(await request).toMatchObject({
      status: 'succeeded',
      usageStatus: 'unknown',
      inputTokens: null,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    { raw: undefined, status: 'unknown', input: null },
    { raw: { prompt_tokens: 19 }, status: 'partial', input: 19 },
    {
      raw: { prompt_tokens: 19, completion_tokens: 8, total_tokens: 27 },
      status: 'known',
      input: 19,
    },
  ])(
    'preserves raw $status usage through real provider adapter',
    async ({ raw, status, input }) => {
      const fetch = vi
        .fn()
        .mockImplementation(
          async () => new Response(sse(raw), { headers: { 'content-type': 'text/event-stream' } }),
        );
      vi.stubGlobal('fetch', fetch);
      const result = await completeTranslation(
        model,
        'local-test-only',
        'The experiment did not improve accuracy.',
      );
      expect(result).toMatchObject({
        status: 'succeeded',
        text: '实验没有提高准确率。',
        usageStatus: status,
        inputTokens: input,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['stop', 'length'] as const)(
    'reserves model output for reasoning on a short paragraph and preserves %s semantics',
    async (finishReason) => {
      const fetch = vi.fn().mockImplementation(async (_url, init) => {
        const request = JSON.parse(init.body as string);
        expect(request.max_tokens ?? request.max_completion_tokens).toBe(8192);
        const chunk = (delta: Record<string, string>, finish: string | null = null) =>
          'data: ' +
          JSON.stringify({
            id: 'reasoning',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'qwen3.8-flash',
            choices: [{ index: 0, delta, finish_reason: finish }],
          }) +
          '\n\n';
        return new Response(
          chunk({ reasoning_content: 'Private reasoning must not enter the draft.' }) +
            chunk({ content: '实验没有提高准确率。' }) +
            chunk({}, finishReason) +
            'data: ' +
            JSON.stringify({
              choices: [],
              usage: {
                prompt_tokens: 226,
                completion_tokens: finishReason === 'stop' ? 2048 : 8192,
                completion_tokens_details: { reasoning_tokens: 1900 },
              },
            }) +
            '\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      });
      vi.stubGlobal('fetch', fetch);
      const drafts: string[] = [];
      const result = await completeTranslation(
        { ...model, model: 'qwen3.8-flash' },
        'local-only',
        'x'.repeat(425),
        '',
        (text) => drafts.push(text),
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(drafts.join('')).not.toContain('Private');
      expect(result).toMatchObject({
        status: finishReason === 'stop' ? 'succeeded' : 'failed',
        usageStatus: 'partial',
        totalTokens: null,
        outputTokens: finishReason === 'stop' ? 2048 : 8192,
      });
      if (finishReason === 'length') {
        expect(result.errorCode).toBe('LLM_OUTPUT_TRUNCATED');
        expect(result.text).toBeUndefined();
      } else expect(result.text).toBe('实验没有提高准确率。');
    },
  );
  it('allows at most one underlying HTTP attempt even when real SDK receives network failure', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('connection dropped'));
    vi.stubGlobal('fetch', fetch);
    expect(await completeTranslation(model, 'local-test-only', 'source')).toMatchObject({
      status: 'unknown',
      usageStatus: 'unknown',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
