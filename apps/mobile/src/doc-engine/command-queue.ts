import type { DocEngineCommand } from '../../../../packages/doc-engine/src/protocol';

export type CommandQueueState = {
  ready: boolean;
  pending: DocEngineCommand[];
};

export function emptyCommandQueue(): CommandQueueState {
  return { ready: false, pending: [] };
}

/**
 * Ready 前到达的命令必须排队，不能直接 injectJavaScript。
 *
 * WebView 引擎在 `ready` 事件之前尚未安装 `window.__docEngine.dispatch`，
 * 提前注入会静默丢失。收到 ready 后再按序 flush；`init` 永远排在最前
 * （协议约定 setContent 之前必须先 init）。
 */
export function enqueueCommand(
  state: CommandQueueState,
  cmd: DocEngineCommand,
): { state: CommandQueueState; flush: DocEngineCommand[] } {
  if (!state.ready) {
    const pending =
      cmd.type === 'init'
        ? // 后来的 init 覆盖先前的，并保持队首。
          [cmd, ...state.pending.filter((item) => item.type !== 'init')]
        : [...state.pending, cmd];
    return { state: { ready: false, pending }, flush: [] };
  }
  return { state, flush: [cmd] };
}

/** 引擎 `ready` 之后：init 永远第一个，其余保持入队顺序。 */
export function markQueueReady(
  state: CommandQueueState,
): { state: CommandQueueState; flush: DocEngineCommand[] } {
  if (state.ready) return { state, flush: [] };
  const init = state.pending.filter((item) => item.type === 'init');
  const rest = state.pending.filter((item) => item.type !== 'init');
  return {
    state: { ready: true, pending: [] },
    flush: [...init, ...rest],
  };
}

export function resetCommandQueue(): CommandQueueState {
  return emptyCommandQueue();
}
