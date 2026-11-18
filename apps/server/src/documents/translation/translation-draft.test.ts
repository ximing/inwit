import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTranslationDraftSink } from './translation-draft.js';
afterEach(() => vi.useRealTimers());
describe('translation draft coalescing', () => {
  it('flushes first text immediately and coalesces slow writes before terminal completion', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const sink = createTranslationDraftSink(write);
    sink.push('一');
    expect(write).toHaveBeenCalledWith('一');
    for (let i = 0; i < 100; i++) sink.push(`最新${i}`);
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    const finish = sink.finish();
    release();
    await finish;
    expect(write.mock.calls.map((c) => c[0])).toEqual(['一', '最新99']);
    sink.push('迟到');
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
