import type { PmDocJson } from '@inwit/dto';
import type {
  DocEngineEvent,
  FormatState,
  SelectionAction,
  TextSelectionAnchor,
  ViewportRect,
} from '../../../../packages/doc-engine/src/protocol';

const PROTOCOL_VERSION = 1;
const EVENT_TYPES = new Set<DocEngineEvent['type']>([
  'ready',
  'error',
  'anchorClick',
  'annotationClick',
  'selectionChange',
  'selectionAction',
  'assetNeeded',
  'linkClick',
  'docChanged',
  'docJson',
  'formatState',
]);

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; message: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAction(value: unknown): value is SelectionAction {
  return value === 'annotate' || value === 'card' || value === 'digest';
}

function parseAnchor(value: unknown): TextSelectionAnchor | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (typeof value.text !== 'string') return undefined;
  if (typeof value.blockIndex !== 'number' || typeof value.from !== 'number' || typeof value.to !== 'number') {
    return undefined;
  }
  return {
    text: value.text,
    blockIndex: value.blockIndex,
    from: value.from,
    to: value.to,
  };
}

function parseRect(value: unknown): ViewportRect | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.x !== 'number' ||
    typeof value.y !== 'number' ||
    typeof value.width !== 'number' ||
    typeof value.height !== 'number'
  ) {
    return undefined;
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

function parseFormatState(value: unknown): FormatState | null {
  if (!isRecord(value)) return null;
  const flags = [
    'bold',
    'italic',
    'strike',
    'heading1',
    'heading2',
    'bulletList',
    'orderedList',
    'taskList',
    'blockquote',
    'codeBlock',
    'link',
    'table',
    'canUndo',
    'canRedo',
  ] as const;
  if (typeof value.editable !== 'boolean') return null;
  for (const key of flags) {
    if (typeof value[key] !== 'boolean') return null;
  }
  if (value.textAlign !== 'left' && value.textAlign !== 'center' && value.textAlign !== 'right') return null;
  return {
    editable: value.editable,
    bold: value.bold as boolean,
    italic: value.italic as boolean,
    strike: value.strike as boolean,
    heading1: value.heading1 as boolean,
    heading2: value.heading2 as boolean,
    bulletList: value.bulletList as boolean,
    orderedList: value.orderedList as boolean,
    taskList: value.taskList as boolean,
    blockquote: value.blockquote as boolean,
    codeBlock: value.codeBlock as boolean,
    link: value.link as boolean,
    table: value.table as boolean,
    textAlign: value.textAlign,
    canUndo: value.canUndo as boolean,
    canRedo: value.canRedo as boolean,
  };
}

function parseStrings(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    out.push(item);
  }
  return out;
}

export function parseDocEngineEvent(raw: unknown): ParseResult<DocEngineEvent> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, message: 'invalid json' };
    }
  }
  if (!isRecord(value)) return { ok: false, message: 'message must be an object' };
  if (value.v !== PROTOCOL_VERSION) {
    return { ok: false, message: `unsupported protocol version: ${String(value.v)}` };
  }
  if (typeof value.type !== 'string' || !EVENT_TYPES.has(value.type as DocEngineEvent['type'])) {
    return { ok: false, message: `unknown event: ${String(value.type)}` };
  }
  const type = value.type as DocEngineEvent['type'];
  const payload = value.payload;

  switch (type) {
    case 'ready':
      return { ok: true, value: { type: 'ready' } };
    case 'error': {
      if (!isRecord(payload) || typeof payload.message !== 'string') {
        return { ok: false, message: 'error payload requires message' };
      }
      const evt: DocEngineEvent = { type: 'error', payload: { message: payload.message } };
      if (typeof payload.stack === 'string') evt.payload.stack = payload.stack;
      return { ok: true, value: evt };
    }
    case 'anchorClick': {
      const cardIds = isRecord(payload) ? parseStrings(payload.cardIds) : null;
      if (!cardIds) return { ok: false, message: 'anchorClick payload requires cardIds' };
      return { ok: true, value: { type, payload: { cardIds } } };
    }
    case 'annotationClick': {
      const annotationIds = isRecord(payload) ? parseStrings(payload.annotationIds) : null;
      if (!annotationIds) return { ok: false, message: 'annotationClick payload requires annotationIds' };
      return { ok: true, value: { type, payload: { annotationIds } } };
    }
    case 'selectionChange': {
      if (!isRecord(payload)) return { ok: false, message: 'selectionChange payload required' };
      const anchor = parseAnchor(payload.anchor);
      const rect = parseRect(payload.rect);
      if (anchor === undefined || rect === undefined) {
        return { ok: false, message: 'selectionChange payload is invalid' };
      }
      return { ok: true, value: { type, payload: { anchor, rect } } };
    }
    case 'selectionAction': {
      if (!isRecord(payload) || !isAction(payload.action)) {
        return { ok: false, message: 'selectionAction payload requires action' };
      }
      const anchor = parseAnchor(payload.anchor);
      if (!anchor) return { ok: false, message: 'selectionAction payload requires anchor' };
      return { ok: true, value: { type, payload: { action: payload.action, anchor } } };
    }
    case 'assetNeeded': {
      const srcs = isRecord(payload) ? parseStrings(payload.srcs) : null;
      if (!srcs) return { ok: false, message: 'assetNeeded payload requires srcs' };
      return { ok: true, value: { type, payload: { srcs } } };
    }
    case 'linkClick': {
      if (!isRecord(payload) || typeof payload.href !== 'string') {
        return { ok: false, message: 'linkClick payload requires href' };
      }
      return { ok: true, value: { type, payload: { href: payload.href } } };
    }
    case 'docChanged':
      return { ok: true, value: { type: 'docChanged' } };
    case 'docJson': {
      if (!isRecord(payload) || typeof payload.requestId !== 'string' || payload.requestId.length === 0) {
        return { ok: false, message: 'docJson payload requires requestId' };
      }
      if (!isRecord(payload.doc) || payload.doc.type !== 'doc') {
        return { ok: false, message: 'docJson payload.doc must be a PM doc' };
      }
      return {
        ok: true,
        value: { type: 'docJson', payload: { requestId: payload.requestId, doc: payload.doc as PmDocJson } },
      };
    }
    case 'formatState': {
      const state = parseFormatState(payload);
      if (!state) return { ok: false, message: 'formatState payload is invalid' };
      return { ok: true, value: { type: 'formatState', payload: state } };
    }
    default: {
      const _never: never = type;
      return { ok: false, message: `unknown event: ${String(_never)}` };
    }
  }
}

export function dispatchScript(cmd: {
  type: string;
  payload?: unknown;
}): string {
  const envelope = {
    v: PROTOCOL_VERSION,
    type: cmd.type,
    ...(cmd.payload !== undefined ? { payload: cmd.payload } : {}),
  };
  const json = JSON.stringify(envelope);
  return `(function(){try{window.__docEngine&&window.__docEngine.dispatch(${json});}catch(e){}})();true;`;
}
