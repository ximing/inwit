import { describe, expect, it } from 'vitest';
import {
  emptyCommandQueue,
  enqueueCommand,
  markQueueReady,
  resetCommandQueue,
} from '../command-queue';
import type { DocEngineCommand } from '../../../../../packages/doc-engine/src/protocol';

const init = {
  type: 'init' as const,
  payload: { theme: 'light' as const, platform: 'ios' as const },
};
const content: DocEngineCommand = {
  type: 'setContent',
  payload: { doc: { type: 'doc', content: [{ type: 'paragraph' }] } },
};
const theme: DocEngineCommand = { type: 'setTheme', payload: { theme: 'dark' } };

describe('command queue', () => {
  it('buffers commands until ready and flushes init first', () => {
    let state = emptyCommandQueue();

    let result = enqueueCommand(state, content);
    expect(result.flush).toEqual([]);
    state = result.state;

    result = enqueueCommand(state, init);
    expect(result.flush).toEqual([]);
    state = result.state;

    result = enqueueCommand(state, theme);
    expect(result.flush).toEqual([]);
    state = result.state;

    const flushed = markQueueReady(state);
    expect(flushed.flush.map((cmd) => cmd.type)).toEqual(['init', 'setContent', 'setTheme']);
    expect(flushed.state.ready).toBe(true);
    expect(flushed.state.pending).toEqual([]);
  });

  it('sends immediately after ready', () => {
    const ready = markQueueReady(emptyCommandQueue());
    const result = enqueueCommand(ready.state, content);
    expect(result.flush).toEqual([content]);
  });

  it('replaces a queued init and keeps it first', () => {
    let state = emptyCommandQueue();
    state = enqueueCommand(state, content).state;
    state = enqueueCommand(state, init).state;
    const darkInit: DocEngineCommand = {
      type: 'init',
      payload: { theme: 'dark', platform: 'android' },
    };
    state = enqueueCommand(state, darkInit).state;
    const flushed = markQueueReady(state);
    expect(flushed.flush[0]).toEqual(darkInit);
    expect(flushed.flush.map((cmd) => cmd.type)).toEqual(['init', 'setContent']);
  });

  it('reset drops the buffer and ready flag', () => {
    let state = enqueueCommand(emptyCommandQueue(), content).state;
    state = markQueueReady(state).state;
    state = resetCommandQueue();
    expect(state).toEqual(emptyCommandQueue());
    const queued = enqueueCommand(state, theme);
    expect(queued.flush).toEqual([]);
  });
});
