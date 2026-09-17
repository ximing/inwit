import {
  errorPayloadFromUnknown,
  parseIncomingMessage,
  PROTOCOL_VERSION,
  type DocEngineCommand,
  type DocEngineEvent,
} from './protocol';

export type CommandHandler = (cmd: DocEngineCommand) => void;
export type EventSink = (evt: DocEngineEvent) => void;

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (msg: string) => void };
    __docEngine?: { dispatch: (msg: unknown) => void };
    __onDocEngineEvent?: (evt: DocEngineEvent) => void;
  }
}

function defaultSink(evt: DocEngineEvent): void {
  const envelope = { v: PROTOCOL_VERSION, ...evt };
  const rn = typeof window !== 'undefined' ? window.ReactNativeWebView : undefined;
  if (rn && typeof rn.postMessage === 'function') {
    rn.postMessage(JSON.stringify(envelope));
    return;
  }
  if (typeof window !== 'undefined') {
    window.__onDocEngineEvent?.(evt);
  }
  console.log('[doc-engine]', evt);
}

let sink: EventSink = defaultSink;

/** 测试用：替换出桥实现。传 `null` 恢复默认。 */
export function setEventSink(next: EventSink | null): void {
  sink = next ?? defaultSink;
}

export function emitEvent(evt: DocEngineEvent): void {
  sink(evt);
}

export function createDispatcher(handler: CommandHandler, emit: EventSink = emitEvent): (raw: unknown) => void {
  return (raw: unknown) => {
    try {
      const parsed = parseIncomingMessage(raw);
      if (!parsed.ok) {
        emit({ type: 'error', payload: { message: parsed.message } });
        return;
      }
      handler(parsed.value);
    } catch (err) {
      emit({ type: 'error', payload: errorPayloadFromUnknown(err) });
    }
  };
}

export function installBridge(handler: CommandHandler): { dispatch: (raw: unknown) => void } {
  const dispatch = createDispatcher(handler);
  if (typeof window !== 'undefined') {
    window.__docEngine = { dispatch };
  }
  return { dispatch };
}
